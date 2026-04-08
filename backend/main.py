from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os
import json
import sqlite3
import requests
import re
import time
import asyncio
import threading
from collections import defaultdict
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from requests.auth import HTTPBasicAuth
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

# Reusable session for connection pooling (keeps TCP+TLS alive across pages)
_jira_session = requests.Session()
_jira_session.verify = False

# Lock to prevent concurrent Jira fetches from racing on the DB
_fetch_lock = threading.Lock()

# Live progress for the background fetch task
_fetch_status: dict[str, Any] = {
    "running": False,
    "pages_fetched": 0,
    "tickets_so_far": 0,
    "done": True,
    "error": None,
    "result": None,  # final summary when done
}

DUPLICATE_CANDIDATE_CACHE: dict[str, Any] = {
    "expiresAt": 0.0,
    "key": None,
    "value": None,
}

JIRA_FIELD_CACHE: dict[str, Any] = {
    "expiresAt": 0.0,
    "key": None,
    "nciSeverityFieldId": None,
}


def _resolve_key_prefix(project_key: str) -> str:
    """Resolve the actual Jira issue key prefix from the database.

    Jira allows the project key (used in project settings / JQL) to differ
    from the issue key prefix.  E.g., project "INCIDENT" may use issue keys
    like "NCIP-123".  This function detects the actual prefix stored in the
    DB so that LIKE filters match correctly.
    """
    if not project_key:
        return ""
    upper = project_key.upper().strip()
    try:
        conn = sqlite3.connect("tickets.db")
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT SUBSTR(jira_key, 1, INSTR(jira_key, '-')-1) "
            "FROM tickets WHERE jira_key LIKE '%-%'"
        )
        prefixes = [row[0] for row in cursor.fetchall() if row[0]]
        conn.close()

        if not prefixes:
            # No tickets in DB yet – fall back to projectKey as-is
            return f"{upper}-%"

        # If the projectKey directly matches a stored prefix, use it
        if upper in prefixes:
            return f"{upper}-%"

        # Otherwise use the first (usually only) prefix in the DB
        return f"{prefixes[0]}-%"
    except Exception:
        return f"{upper}-%"


class JiraSettings(BaseModel):
    url: str
    email: str
    apiToken: str
    projectKey: str
    daysBack: int = 30
    quickFilterId: Optional[int] = None
    jql: Optional[str] = None   # custom JQL from Settings UI; overrides default filter
    confluenceSpaces: Optional[str] = None  # comma-separated Confluence space keys to scope KB search

class FetchTicketsRequest(BaseModel):
    jiraSettings: Optional[JiraSettings] = None
    forceFullRefresh: bool = False

class RootCauseAnalyzeRequest(BaseModel):
    ticketKey: str
    jiraSettings: Optional[JiraSettings] = None

class BatchConfluenceLinksRequest(BaseModel):
    ticketKeys: List[str]
    jiraSettings: Optional[JiraSettings] = None

class ResolutionAssistantRequest(BaseModel):
    ticketKey: str
    jiraSettings: Optional[JiraSettings] = None
    lookbackDays: int = 90
    maxCandidates: int = 120
    kbLimit: int = 4

class TicketData(BaseModel):
    key: str
    summary: str
    status: str
    priority: str
    created: str
    assignee: str
    description: str


STOP_WORDS = {
    "the", "and", "for", "with", "that", "this", "from", "have", "has",
    "are", "was", "were", "into", "over", "under", "your", "their", "our",
    "will", "would", "could", "should", "about", "after", "before", "into",
    "issue", "ticket", "incident", "ncip", "able", "n-able", "when", "then",
    "not", "you", "all", "can", "had", "did", "its", "it's", "but", "out",
}

ACTION_HINTS = [
    "check", "verify", "collect", "review", "restart", "reproduce", "clear",
    "flush", "rollback", "workaround", "temporary", "disable", "enable",
    "ask customer", "capture", "compare", "validate", "monitor", "logs",
]


def _to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return _extract_adf_text(value)
    if isinstance(value, list):
        return " ".join(_to_text(v) for v in value)
    return str(value)


def _tokenize(text: str) -> list[str]:
    if not text:
        return []
    parts = re.findall(r"[a-z0-9_\-]{3,}", text.lower())
    return [p for p in parts if p not in STOP_WORDS]


def _token_set(text: str) -> set[str]:
    return set(_tokenize(text))


def _jaccard_similarity(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def _trim(text: str, limit: int = 240) -> str:
    s = (text or "").strip()
    if len(s) <= limit:
        return s
    return s[: limit - 1].rstrip() + "…"


def _parse_iso_datetime(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _extract_action_lines(text: str, max_items: int = 6) -> list[str]:
    if not text:
        return []
    lines = re.split(r"[\n\r\.\;]+", text)
    picked: list[str] = []
    seen: set[str] = set()
    for raw in lines:
        line = raw.strip()
        if not line or len(line) < 14:
            continue
        low = line.lower()
        if not any(h in low for h in ACTION_HINTS):
            continue
        key = re.sub(r"\s+", " ", low)
        if key in seen:
            continue
        seen.add(key)
        picked.append(_trim(line, 400))
        if len(picked) >= max_items:
            break
    return picked


def _extract_issue_text(issue_fields: dict[str, Any]) -> dict[str, Any]:
    summary = issue_fields.get("summary") or ""
    description = _extract_adf_text(issue_fields.get("description")) if issue_fields.get("description") else ""
    labels = issue_fields.get("labels") or []
    components = [c.get("name") for c in (issue_fields.get("components") or []) if isinstance(c, dict) and c.get("name")]
    comments_raw = (((issue_fields.get("comment") or {}).get("comments") or []))
    comments = []
    for c in comments_raw:
        extracted_text = _extract_adf_text(c.get("body"))
        if extracted_text:
            comments.append(extracted_text)

    resolution_obj = issue_fields.get("resolution")
    if isinstance(resolution_obj, dict):
        resolution = resolution_obj.get("description") or resolution_obj.get("name") or ""
    elif isinstance(resolution_obj, str):
        resolution = resolution_obj
    else:
        resolution = ""

    status_obj = issue_fields.get("status")
    status_name = status_obj.get("name") if isinstance(status_obj, dict) else str(status_obj or "Unknown")
    priority_obj = issue_fields.get("priority")
    priority_name = priority_obj.get("name") if isinstance(priority_obj, dict) else str(priority_obj or "Unknown")

    combined_text = " ".join([
        summary,
        description,
        " ".join(labels),
        " ".join(components),
    ])

    return {
        "summary": summary,
        "description": description,
        "labels": labels,
        "components": components,
        "comments": comments,
        "resolution": resolution,
        "status": status_name,
        "priority": priority_name,
        "token_set": _token_set(combined_text),
        "summary_tokens": _token_set(summary),
    }


# Very common / generic terms that dilute Confluence search relevance
_KB_NOISE_WORDS: set[str] = {
    "issue", "error", "problem", "incident", "ticket", "bug", "request",
    "please", "help", "need", "unable", "cannot", "getting", "received",
    "customer", "user", "client", "reported", "report", "see", "below",
    "following", "details", "description", "steps", "update", "updated",
    "new", "old", "not", "working", "work", "does", "doesn", "didn",
    "expected", "actual", "behavior", "result", "since", "when",
    "after", "before", "while", "during", "between", "from", "into",
    "also", "still", "again", "same", "other", "another", "some",
    "the", "and", "for", "with", "this", "that", "are", "was", "has",
}


def _build_kb_query(ticket: dict[str, Any]) -> str:
    """Build a focused Confluence search query from ticket fields.

    Prioritises component/product names and labels (which tend to be the most
    specific) then adds the most distinctive summary words, filtering out
    generic noise so Confluence relevance ranking works well.
    """
    # Components & labels are typically short, specific terms — prioritise them
    comp_terms = _tokenize(" ".join(ticket.get("components", [])))
    label_terms = _tokenize(" ".join(ticket.get("labels", [])))
    summary_terms = _tokenize(ticket.get("summary", ""))

    # Filter out generic noise from summary (components/labels are kept as-is)
    summary_terms = [t for t in summary_terms if t not in _KB_NOISE_WORDS]

    # Combine: components first, then labels, then summary keywords
    parts = comp_terms + label_terms + summary_terms
    deduped: list[str] = []
    seen: set[str] = set()
    for p in parts:
        if p in seen:
            continue
        seen.add(p)
        deduped.append(p)
    if not deduped:
        return "incident troubleshooting"
    # Keep to ≤6 tokens for a sharper search
    return " ".join(deduped[:6])


ROOT_CAUSE_RULES: dict[str, dict[str, Any]] = {
    "Configuration Issue": {
        "keywords": [
            "misconfig", "misconfigured", "configuration", "config", "incorrect setting",
            "feature flag", "flag disabled", "parameter", "property", "env var", "yaml", "json config"
        ],
        "recommendations": [
            "Compare runtime configuration between working and failing environments.",
            "Validate feature flags, secrets, and environment variables.",
            "Add configuration validation checks in startup/CI pipelines."
        ]
    },
    "Code/Logic Issue": {
        "keywords": [
            "null pointer", "exception", "stack trace", "regression", "bug", "logic", "off by one",
            "race condition", "deadlock", "syntax", "type error", "index out of range", "code fix"
        ],
        "recommendations": [
            "Review recent code changes and correlate with issue start time.",
            "Add/expand unit and integration tests for the failing scenario.",
            "Implement fix behind a guarded rollout and monitor post-deploy metrics."
        ]
    },
    "Environment/Infrastructure Issue": {
        "keywords": [
            "cpu", "memory", "disk", "latency", "timeout", "network", "dns", "kubernetes",
            "pod", "node", "container", "deployment", "infrastructure", "ssl", "certificate", "load balancer"
        ],
        "recommendations": [
            "Check infrastructure health metrics and recent infra/deploy events.",
            "Validate network/DNS/connectivity paths across dependent services.",
            "Scale or remediate constrained resources and confirm recovery."
        ]
    },
    "Data Issue": {
        "keywords": [
            "data corruption", "invalid data", "schema", "migration", "duplicate", "null data",
            "stale data", "missing record", "data mismatch", "etl", "constraint", "foreign key"
        ],
        "recommendations": [
            "Validate impacted records and data quality constraints.",
            "Run corrective scripts/migrations with audit trail.",
            "Add data validation and monitoring alerts for recurrence prevention."
        ]
    },
    "Third-party Dependency Issue": {
        "keywords": [
            "third-party", "vendor", "dependency", "sdk", "api limit", "rate limit", "429",
            "upstream", "outage", "service unavailable", "gateway", "webhook", "oauth"
        ],
        "recommendations": [
            "Verify provider status pages and incident notices.",
            "Add retries/backoff/circuit-breaker handling for dependency failures.",
            "Coordinate with vendor support and track mitigation ETA."
        ]
    },
}


CATEGORY_BASE_SCORE: dict[str, float] = {
    "Configuration Issue": 0.0,
    "Code/Logic Issue": 0.0,
    "Environment/Infrastructure Issue": 0.0,
    "Data Issue": 0.0,
    "Third-party Dependency Issue": 0.0,
}

FIELD_WEIGHTS: dict[str, float] = {
    "summary": 2.0,
    "resolution": 1.8,
    "labels": 1.5,
    "components": 1.4,
    "description": 1.1,
    "environment": 1.2,
    "comments": 0.9,
}

WEAK_KEYWORDS = {
    "exception", "timeout", "gateway", "dependency", "config", "schema", "bug"
}


def _find_keyword_indicators(text: str) -> dict[str, list[str]]:
    indicators: dict[str, list[str]] = {category: [] for category in ROOT_CAUSE_RULES.keys()}
    lower_text = text.lower()
    for category, rule in ROOT_CAUSE_RULES.items():
        for keyword in rule["keywords"]:
            if keyword in lower_text:
                indicators[category].append(keyword)
    return indicators


def _extract_log_hints(text: str) -> list[str]:
    if not text:
        return []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    pattern = re.compile(r"(error|exception|traceback|timeout|failed|failure|stack|503|429|service unavailable)", re.IGNORECASE)
    hints: list[str] = []
    for line in lines:
        normalized = line
        if line.startswith("{") and "Message" in line:
            try:
                payload = json.loads(line)
                message = str(payload.get("Message") or "").strip()
                level = str(payload.get("Level") or "").strip()
                if message:
                    normalized = f"[{level}] {message}" if level else message
            except Exception:
                normalized = line

        if pattern.search(normalized):
            normalized = re.sub(r"\s+", " ", normalized).strip()
            hints.append(normalized[:220])
        if len(hints) >= 8:
            break
    return hints


def _summarize_issue(summary: str, description: str) -> str:
    clean_summary = (summary or "").strip()
    clean_description = re.sub(r"\s+", " ", (description or "").strip())
    if not clean_summary and not clean_description:
        return "Insufficient ticket details available for a concise summary."
    if not clean_description:
        return clean_summary
    snippet = clean_description[:180] + ("..." if len(clean_description) > 180 else "")
    return f"{clean_summary}: {snippet}" if clean_summary else snippet


def _classify_root_cause(extracted: dict[str, Any]) -> dict[str, Any]:
    summary = extracted.get("summary", "")
    description = extracted.get("description", "")
    resolution = extracted.get("resolution_notes", "")
    environment = extracted.get("environment", "")
    comments = extracted.get("comments", [])
    labels = extracted.get("labels", [])
    components = extracted.get("components", [])

    comments_text = "\n".join(comments)
    labels_text = " ".join(labels)
    components_text = " ".join(components)
    searchable_fields = {
        "summary": summary,
        "description": description,
        "resolution": resolution,
        "environment": environment,
        "comments": comments_text,
        "labels": labels_text,
        "components": components_text,
    }
    corpus = "\n".join(searchable_fields.values()).lower()

    scores: dict[str, float] = {k: v for k, v in CATEGORY_BASE_SCORE.items()}
    evidence: dict[str, list[dict[str, Any]]] = {category: [] for category in ROOT_CAUSE_RULES.keys()}

    for field_name, field_text in searchable_fields.items():
        normalized = (field_text or "").lower()
        if not normalized:
            continue
        field_weight = FIELD_WEIGHTS.get(field_name, 1.0)

        for category, rule in ROOT_CAUSE_RULES.items():
            for keyword in rule["keywords"]:
                token = keyword.lower().strip()
                if not token:
                    continue
                if len(token) <= 3:
                    token_match = re.search(rf"\b{re.escape(token)}\b", normalized)
                else:
                    token_match = token in normalized
                if not token_match:
                    continue

                base = 0.7 if token in WEAK_KEYWORDS else 1.0
                contribution = round(base * field_weight, 2)
                scores[category] += contribution
                evidence[category].append({
                    "keyword": token,
                    "field": field_name,
                    "score": contribution,
                })

    if re.search(r"\b(429|503|502|504)\b", corpus) and re.search(r"(api|rest|upstream|vendor|service unavailable|sharepoint|oauth|webhook)", corpus):
        scores["Third-party Dependency Issue"] += 2.5
        evidence["Third-party Dependency Issue"].append({
            "keyword": "http status + upstream api signal",
            "field": "comments",
            "score": 2.5,
        })

    if re.search(r"(cpu|memory|disk|latency|dns|kubernetes|pod|node|ssl|certificate|connection refused)", corpus):
        scores["Environment/Infrastructure Issue"] += 1.8
        evidence["Environment/Infrastructure Issue"].append({
            "keyword": "infra/runtime health signal",
            "field": "description",
            "score": 1.8,
        })

    if re.search(r"(null pointer|traceback|stack trace|index out of range|typeerror|syntaxerror|regression|logic)\b", corpus):
        scores["Code/Logic Issue"] += 1.8
        evidence["Code/Logic Issue"].append({
            "keyword": "code defect pattern",
            "field": "description",
            "score": 1.8,
        })

    if re.search(r"(schema|migration|duplicate|foreign key|constraint|stale data|missing record|data mismatch)", corpus):
        scores["Data Issue"] += 1.8
        evidence["Data Issue"].append({
            "keyword": "data integrity pattern",
            "field": "description",
            "score": 1.8,
        })

    if re.search(r"(misconfig|incorrect setting|feature flag|env var|yaml|json config|configuration)", corpus):
        scores["Configuration Issue"] += 1.8
        evidence["Configuration Issue"].append({
            "keyword": "configuration mismatch pattern",
            "field": "description",
            "score": 1.8,
        })

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    top_category, top_score = ranked[0] if ranked else ("Unknown / Needs Investigation", 0.0)
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    margin = top_score - second_score

    if top_score < 1.4:
        final_category = "Unknown / Needs Investigation"
    elif margin < 0.45 and top_score < 2.8:
        final_category = "Unknown / Needs Investigation"
    else:
        final_category = top_category

    key_indicators: list[str] = []
    if final_category != "Unknown / Needs Investigation":
        ranked_evidence = sorted(evidence.get(final_category, []), key=lambda x: x["score"], reverse=True)
        seen: set[str] = set()
        for ev in ranked_evidence:
            signature = f"{ev['keyword']}|{ev['field']}"
            if signature in seen:
                continue
            seen.add(signature)
            key_indicators.append(
                f"Matched '{ev['keyword']}' in {ev['field']} (impact {ev['score']})."
            )
            if len(key_indicators) >= 4:
                break
    else:
        key_indicators.append("Evidence is present but split across categories without a strong winner.")
        for category, score in ranked[:3]:
            if score > 0:
                key_indicators.append(f"{category}: score {round(score, 2)}")

    log_hints = _extract_log_hints("\n".join([description, comments_text, resolution]))
    for hint in log_hints[:3]:
        key_indicators.append(f"Log hint: {hint}")

    total_score = sum(scores.values())
    if final_category == "Unknown / Needs Investigation":
        confidence = 0.3 if total_score > 0 else 0.2
    else:
        confidence = min(0.96, 0.5 + (min(top_score, 6.0) * 0.07) + (max(margin, 0) * 0.06))

    recommendations = (
        ROOT_CAUSE_RULES[final_category]["recommendations"]
        if final_category in ROOT_CAUSE_RULES
        else [
            "Collect additional logs and reproduction steps.",
            "Confirm ownership between Engineering, Support, and Product.",
            "Re-run analysis once more evidence is available."
        ]
    )

    return {
        "rootCauseCategory": final_category,
        "shortSummary": _summarize_issue(summary, description),
        "keyIndicators": key_indicators[:6],
        "suggestedNextSteps": recommendations,
        "confidence": round(confidence, 2),
        "scoreBreakdown": {k: round(v, 2) for k, v in scores.items()},
        "extractedDetails": {
            "summary": summary,
            "status": extracted.get("status", "Unknown"),
            "priority": extracted.get("priority", "Unknown"),
            "description": description,
            "resolutionNotes": resolution,
            "comments": comments[:10],
            "labels": labels,
            "components": components,
            "logHints": log_hints,
        }
    }

app = FastAPI(
    title="Incident Triage API",
    description="Automated Jira incident triage system",
    version="1.0.0"
)

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Incident Triage API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "incident-triage-api"}

# Initialize database
def init_db():
    conn = sqlite3.connect('tickets.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jira_key TEXT UNIQUE NOT NULL,
            summary TEXT NOT NULL,
            status TEXT NOT NULL,
            priority TEXT NOT NULL,
            created_date TEXT NOT NULL,
            assignee TEXT,
            description TEXT,
            jira_components TEXT,
            product_name TEXT,
            component TEXT,
            severity_score REAL,
            routing_suggestion TEXT,
            confidence_score REAL,
            issue_type TEXT,
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Lightweight migration for existing databases: add missing columns
    cursor.execute("PRAGMA table_info(tickets)")
    existing_columns = {row[1] for row in cursor.fetchall()}

    # sqlite supports ADD COLUMN on the fly; ignore errors if column exists
    if 'jira_components' not in existing_columns:
        cursor.execute('ALTER TABLE tickets ADD COLUMN jira_components TEXT')
    if 'product_name' not in existing_columns:
        cursor.execute('ALTER TABLE tickets ADD COLUMN product_name TEXT')
    if 'resolution_notes' not in existing_columns:
        cursor.execute('ALTER TABLE tickets ADD COLUMN resolution_notes TEXT')
    if 'labels' not in existing_columns:
        cursor.execute('ALTER TABLE tickets ADD COLUMN labels TEXT')
    if 'issue_type' not in existing_columns:
        cursor.execute('ALTER TABLE tickets ADD COLUMN issue_type TEXT')

    conn.commit()
    conn.close()

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()

@app.post("/api/debug-fields")
async def debug_jira_fields(settings: JiraSettings):
    """Fetch one ticket with all fields and return non-null custom fields to identify NCI Severity field ID."""
    jira_url = f"{settings.url.rstrip('/')}/rest/api/3/search/jql"
    jql = settings.jql or f"project = {settings.projectKey} ORDER BY created DESC"
    auth = HTTPBasicAuth(settings.email, settings.apiToken)
    resp = requests.get(
        jira_url, auth=auth,
        headers={"Accept": "application/json"},
        params={"jql": jql, "maxResults": 1, "fields": "*all*"},
        timeout=(5, 15), verify=False,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    data = resp.json()
    issues = data.get("issues", [])
    if not issues:
        return {"error": "no issues found"}
    issue = issues[0]
    # Fields may be nested under 'fields' or flat at the issue level
    fields = issue.get("fields") or {k: v for k, v in issue.items() if k not in ("id", "key", "self", "expand")}
    interesting = {
        k: v for k, v in fields.items()
        if v not in (None, [], {}, "") and (k.startswith("customfield") or k == "priority")
    }
    # Also write to file for terminal inspection
    import json as _json
    with open("/tmp/jira_fields.json", "w") as f:
        _json.dump({"key": issue["key"], "fields": interesting}, f, indent=2)
    return {"key": issue["key"], "fields": interesting}

@app.post("/api/test-connection")
async def test_jira_connection(settings: JiraSettings):
    """
    Verify Jira credentials by calling the /myself endpoint
    """
    try:
        url = f"{settings.url.rstrip('/')}/rest/api/3/myself"
        auth = HTTPBasicAuth(settings.email, settings.apiToken)
        # (connect_timeout, read_timeout) - fail fast on bad URLs
        response = requests.get(
            url, auth=auth,
            headers={"Accept": "application/json"},
            timeout=(10, 25),
            verify=False
        )
        
        if response.status_code == 200:
            user = response.json()
            return {
                "status": "success",
                "message": f"Connected as {user.get('displayName', settings.email)}",
                "account": user.get("emailAddress", settings.email)
            }
        elif response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid email or API token")
        elif response.status_code == 403:
            raise HTTPException(status_code=403, detail="Access denied. Check API token permissions.")
        else:
            raise HTTPException(status_code=response.status_code, detail=f"Jira returned: {response.text[:200]}")
    except requests.exceptions.SSLError as e:
        raise HTTPException(status_code=503, detail=f"SSL error connecting to Jira. Check your URL.")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail=f"Cannot reach {settings.url} — check the URL")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Connection timed out while contacting Jira (10s connect / 25s read). Check VPN/network and Jira URL.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _build_cql(query: str, settings: JiraSettings) -> str:
    """Build a space-scoped CQL query.

    If confluenceSpaces is configured, limits results to those spaces.
    Uses title + text matching for relevance.
    """
    safe_query = re.sub(r'[^\w\s\-/.]', ' ', query)
    safe_query = ' '.join(safe_query.split()[:12])
    cql = f'type = "page" AND (title ~ "{safe_query}" OR text ~ "{safe_query}")'

    spaces_raw = getattr(settings, 'confluenceSpaces', None) or ""
    space_keys = [s.strip().upper() for s in spaces_raw.split(',') if s.strip()]
    if space_keys:
        if len(space_keys) == 1:
            cql += f' AND space = "{space_keys[0]}"'
        else:
            space_list = ','.join(f'"{k}"' for k in space_keys)
            cql += f' AND space IN ({space_list})'
    return cql


@app.post("/api/root-cause-analyze")
async def analyze_root_cause(req: RootCauseAnalyzeRequest):
    ticket_key = (req.ticketKey or "").strip().upper()
    if not ticket_key:
        raise HTTPException(status_code=400, detail="ticketKey is required")

    settings = req.jiraSettings
    if not settings:
        raise HTTPException(status_code=400, detail="Jira settings are required. Configure Jira in Settings first.")

    try:
        issue_url = f"{settings.url.rstrip('/')}/rest/api/3/issue/{ticket_key}"
        auth = HTTPBasicAuth(settings.email, settings.apiToken)
        params = {
            "fields": "summary,description,status,priority,resolution,comment,labels,components,environment"
        }
        response = requests.get(
            issue_url,
            auth=auth,
            headers={"Accept": "application/json"},
            params=params,
            timeout=(10, 45),
            verify=False,
        )

        if response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Ticket {ticket_key} was not found in Jira")
        if response.status_code in (401, 403):
            raise HTTPException(status_code=response.status_code, detail="Jira authentication failed. Verify email/token permissions.")
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Jira API error: {response.text[:300]}")

        issue = response.json()
        fields = issue.get("fields") or {}

        comments_raw = (((fields.get("comment") or {}).get("comments") or []))
        comments = []
        for c in comments_raw:
            body = c.get("body")
            extracted_text = _extract_adf_text(body)
            if extracted_text:
                comments.append(extracted_text)

        resolution_obj = fields.get("resolution")
        resolution_notes = ""
        if isinstance(resolution_obj, dict):
            resolution_notes = resolution_obj.get("description") or resolution_obj.get("name") or ""
        elif isinstance(resolution_obj, str):
            resolution_notes = resolution_obj

        status_obj = fields.get("status")
        priority_obj = fields.get("priority")
        extracted = {
            "summary": fields.get("summary") or "",
            "description": _extract_adf_text(fields.get("description")) if fields.get("description") else "",
            "status": status_obj.get("name") if isinstance(status_obj, dict) else str(status_obj or "Unknown"),
            "priority": priority_obj.get("name") if isinstance(priority_obj, dict) else str(priority_obj or "Unknown"),
            "resolution_notes": resolution_notes,
            "comments": comments,
            "labels": fields.get("labels") or [],
            "components": [c.get("name") for c in (fields.get("components") or []) if isinstance(c, dict) and c.get("name")],
            "environment": _extract_adf_text(fields.get("environment")) if fields.get("environment") else "",
        }

        analysis = _classify_root_cause(extracted)
        return {
            "status": "success",
            "ticketKey": ticket_key,
            "analysis": analysis,
        }

    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Timed out while fetching Jira ticket details")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail="Cannot reach Jira. Check URL/network.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Root cause analysis failed: {str(e)}")


# ── Rovo AI Summary ─────────────────────────────────────────────────────────

class RovoSummarizeRequest(BaseModel):
    ticketKey: str
    jiraSettings: Optional[JiraSettings] = None


@app.post("/api/rovo-summarize")
async def rovo_summarize(req: RovoSummarizeRequest):
    """
    Use Atlassian Rovo / AI to generate a structured summary of a Jira ticket.
    Falls back to a local summary built from the ticket data if Rovo is unavailable.
    """
    ticket_key = (req.ticketKey or "").strip().upper()
    if not ticket_key:
        raise HTTPException(status_code=400, detail="ticketKey is required")

    settings = req.jiraSettings
    if not settings:
        raise HTTPException(status_code=400, detail="Jira settings are required.")

    auth = HTTPBasicAuth(settings.email, settings.apiToken)
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    base_url = settings.url.rstrip("/")

    ROVO_PROMPT = (
        f"For Jira ticket {ticket_key}, give a crisp summary including:\n\n"
        "Problem & impact\n"
        "Agreed Solution/Solution Applied (include resolution type e.g. Duplicate, any linked tickets, and what was actually done)\n"
        "Current status\n"
        "Blockers / dependencies\n"
        "What are we waiting on (if anything)\n"
        "Next steps\n\n"
        "Keep it brief and structured."
    )

    # ── Try Rovo / Atlassian Intelligence ────────────────────────────────
    rovo_response_text: Optional[str] = None

    # Attempt 1: Jira AI Assist endpoint (Rovo)
    try:
        rovo_url = f"{base_url}/gateway/api/assist/chat/message"
        rovo_payload = {
            "content": ROVO_PROMPT,
            "context": {
                "issueKey": ticket_key,
            },
            "agent": "ai-agent",
            "experienceId": "jira-issue-view",
        }
        rovo_resp = requests.post(
            rovo_url,
            auth=auth,
            headers=headers,
            json=rovo_payload,
            timeout=(10, 60),
            verify=False,
        )
        if rovo_resp.status_code == 200:
            rovo_data = rovo_resp.json()
            rovo_response_text = (
                rovo_data.get("message", {}).get("content")
                or rovo_data.get("content")
                or rovo_data.get("answer")
                or rovo_data.get("text")
                or rovo_data.get("response")
            )
            # Handle case where response is nested differently
            if not rovo_response_text and isinstance(rovo_data, dict):
                # Try to extract from any string value
                for key, val in rovo_data.items():
                    if isinstance(val, str) and len(val) > 50:
                        rovo_response_text = val
                        break
    except Exception as rovo_err:
        print(f"[rovo] Assist API attempt failed: {rovo_err}")

    # Attempt 2: Atlassian Intelligence summarize endpoint
    if not rovo_response_text:
        try:
            ai_url = f"{base_url}/rest/ai/latest/chat/messages"
            ai_payload = {
                "content": ROVO_PROMPT,
                "context": {"issueKey": ticket_key},
            }
            ai_resp = requests.post(
                ai_url,
                auth=auth,
                headers=headers,
                json=ai_payload,
                timeout=(10, 60),
                verify=False,
            )
            if ai_resp.status_code == 200:
                ai_data = ai_resp.json()
                rovo_response_text = (
                    ai_data.get("message", {}).get("content")
                    or ai_data.get("content")
                    or ai_data.get("answer")
                    or ai_data.get("response")
                )
                if not rovo_response_text and isinstance(ai_data, dict):
                    for key, val in ai_data.items():
                        if isinstance(val, str) and len(val) > 50:
                            rovo_response_text = val
                            break
        except Exception as ai_err:
            print(f"[rovo] AI endpoint attempt failed: {ai_err}")

    # ── Fallback: build summary from ticket data locally ────────────────
    if not rovo_response_text:
        try:
            issue_url = f"{base_url}/rest/api/3/issue/{ticket_key}"
            params = {
                "fields": "summary,description,status,priority,resolution,comment,labels,components,issuelinks"
            }
            resp = requests.get(
                issue_url,
                auth=auth,
                headers={"Accept": "application/json"},
                params=params,
                timeout=(10, 45),
                verify=False,
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Failed to fetch ticket: {resp.text[:300]}")

            issue = resp.json()
            fields = issue.get("fields") or {}

            summary = fields.get("summary") or "No summary"
            description = _extract_adf_text(fields.get("description")) if fields.get("description") else "No description provided."
            status_obj = fields.get("status")
            status_name = status_obj.get("name") if isinstance(status_obj, dict) else str(status_obj or "Unknown")
            priority_obj = fields.get("priority")
            priority_name = priority_obj.get("name") if isinstance(priority_obj, dict) else str(priority_obj or "Unknown")
            resolution_obj = fields.get("resolution")
            resolution_name = resolution_obj.get("name") if isinstance(resolution_obj, dict) and resolution_obj else None

            comments_raw = ((fields.get("comment") or {}).get("comments") or [])
            comment_texts = []
            for c in comments_raw[-10:]:
                body = _extract_adf_text(c.get("body") or "")
                if body and len(body.strip()) > 15:
                    comment_texts.append(body.strip())

            components = [c.get("name") for c in (fields.get("components") or []) if isinstance(c, dict) and c.get("name")]

            # Parse issue links (duplicates, related, blocks, etc.)
            issue_links = fields.get("issuelinks") or []
            linked_info = []
            duplicate_of = None
            for link in issue_links:
                link_type = (link.get("type") or {}).get("name", "")
                inward = (link.get("type") or {}).get("inward", "")
                outward = (link.get("type") or {}).get("outward", "")

                if "inwardIssue" in link:
                    other = link["inwardIssue"]
                    other_key = other.get("key", "")
                    other_summary = (other.get("fields") or {}).get("summary", "")
                    other_status = ((other.get("fields") or {}).get("status") or {}).get("name", "")
                    relation = inward or link_type
                    linked_info.append(f"{relation} {other_key} — {other_summary} (Status: {other_status})")
                    if "duplicate" in link_type.lower():
                        duplicate_of = other_key

                if "outwardIssue" in link:
                    other = link["outwardIssue"]
                    other_key = other.get("key", "")
                    other_summary = (other.get("fields") or {}).get("summary", "")
                    other_status = ((other.get("fields") or {}).get("status") or {}).get("name", "")
                    relation = outward or link_type
                    linked_info.append(f"{relation} {other_key} — {other_summary} (Status: {other_status})")
                    if "duplicate" in link_type.lower():
                        duplicate_of = other_key

            # Build structured summary — run root cause classification first
            rca_extracted = {
                "summary": summary,
                "description": description,
                "resolution_notes": resolution_name or "",
                "comments": comment_texts,
                "labels": fields.get("labels") or [],
                "components": components,
                "environment": "",
            }
            rca_result = _classify_root_cause(rca_extracted)
            root_cause_cat = rca_result.get("rootCauseCategory", "Unknown")

            sections = []
            sections.append(f"**Root Cause Category**\n{root_cause_cat}")
            sections.append(f"**Problem & Impact**\n{summary}")
            if description and description != "No description provided.":
                sections.append(f"{description}")

            # Extract solution/agreement from comments
            solution_keywords = ["fix", "fixed", "solution", "workaround", "resolved", "root cause",
                                 "caused by", "applied", "deployed", "patch", "we found", "agreed",
                                 "duplicate", "marked as duplicate", "original in which"]
            solution_comments = []
            blocker_comments = []
            waiting_comments = []
            for ct in comment_texts:
                lower = ct.lower()
                if any(kw in lower for kw in solution_keywords):
                    solution_comments.append(ct)
                if any(kw in lower for kw in ["block", "depend", "waiting", "pending", "need from"]):
                    blocker_comments.append(ct)
                if any(kw in lower for kw in ["waiting", "pending", "awaiting", "follow up", "eta"]):
                    waiting_comments.append(ct)

            # Build the Agreed Solution / Solution Applied section
            solution_parts = []

            # 1. Resolution info (Duplicate, Fixed, Won't Do, etc.)
            if resolution_name:
                if "duplicate" in resolution_name.lower():
                    dup_target = duplicate_of or "a linked ticket"
                    solution_parts.append(f"Resolution: **{resolution_name}** — This ticket was closed as a duplicate. The investigation and any eventual fix are tracked under **{dup_target}**.")
                else:
                    solution_parts.append(f"Resolution: **{resolution_name}**")

            # 2. Linked tickets context
            if linked_info:
                links_text = "\n".join(f"• {li}" for li in linked_info)
                solution_parts.append(f"Linked tickets:\n{links_text}")

            # 3. Solution-related comments
            if solution_comments:
                ranked = sorted(solution_comments, key=len, reverse=True)
                if len(ranked) == 1:
                    solution_parts.append(f"From comments:\n{ranked[0]}")
                else:
                    combined = "\n\n".join(f"• {c}" for c in ranked[:5])
                    solution_parts.append(f"From comments:\n{combined}")

            if solution_parts:
                sections.append("**Agreed Solution/Solution Applied**\n" + "\n\n".join(solution_parts))
            else:
                sections.append("**Agreed Solution/Solution Applied**\nNo explicit solution agreed upon in comments yet.")

            sections.append(f"**Current Status**\n{status_name}" + (f" (Resolution: {resolution_name})" if resolution_name else ""))

            if blocker_comments:
                ranked_blockers = sorted(blocker_comments, key=len, reverse=True)
                if len(ranked_blockers) == 1:
                    sections.append(f"**Blockers / Dependencies**\n{ranked_blockers[0]}")
                else:
                    combined = "\n\n".join(f"• {c}" for c in ranked_blockers[:3])
                    sections.append(f"**Blockers / Dependencies**\n{combined}")
            else:
                sections.append("**Blockers / Dependencies**\nNone identified from comments.")

            if waiting_comments:
                ranked_waiting = sorted(waiting_comments, key=len, reverse=True)
                if len(ranked_waiting) == 1:
                    sections.append(f"**What We are Waiting On**\n{ranked_waiting[0]}")
                else:
                    combined = "\n\n".join(f"• {c}" for c in ranked_waiting[:3])
                    sections.append(f"**What We are Waiting On**\n{combined}")
            else:
                sections.append("**What We are Waiting On**\nNothing pending based on available comments.")

            # Next steps
            if resolution_name and "duplicate" in resolution_name.lower():
                dup_target = duplicate_of or "the linked ticket"
                sections.append(f"**Next Steps**\nThis ticket is closed as a duplicate. Track progress and any eventual fix under **{dup_target}**.")
            elif status_name.lower() in ("closed", "resolved", "done"):
                sections.append("**Next Steps**\nTicket is resolved. Verify fix in production and close monitoring.")
            elif solution_comments:
                sections.append("**Next Steps**\nConfirm the applied solution is holding. Update ticket with verification results.")
            else:
                sections.append("**Next Steps**\nInvestigate root cause. Review recent changes to impacted components. Update ticket with findings.")

            rovo_response_text = "\n\n".join(sections)

        except HTTPException:
            raise
        except Exception as fallback_err:
            raise HTTPException(status_code=500, detail=f"Failed to generate summary: {str(fallback_err)}")

    return {
        "status": "success",
        "ticketKey": ticket_key,
        "summary": rovo_response_text,
        "source": "rovo" if rovo_response_text and "**Problem" not in (rovo_response_text or "") else "local",
    }


@app.post("/api/resolution-assistant")
async def resolution_assistant(req: ResolutionAssistantRequest):
    ticket_key = (req.ticketKey or "").strip().upper()
    if not ticket_key:
        raise HTTPException(status_code=400, detail="ticketKey is required")

    settings = req.jiraSettings
    if not settings:
        raise HTTPException(status_code=400, detail="Jira settings are required. Configure Jira in Settings first.")

    lookback_days = max(7, min(req.lookbackDays or 90, 365))
    max_candidates = max(20, min(req.maxCandidates or 80, 200))
    kb_limit = max(1, min(req.kbLimit or 5, 10))

    try:
        auth = HTTPBasicAuth(settings.email, settings.apiToken)
        headers = {"Accept": "application/json"}

        target_issue_url: Optional[str] = None
        assumptions: list[str] = []

        # ── Parallel: fetch target ticket from Jira + KB search later ──
        target_resp = requests.get(
            f"{settings.url.rstrip('/')}/rest/api/3/issue/{ticket_key}",
            auth=auth,
            headers=headers,
            params={
                "fields": "summary,description,status,priority,resolution,comment,labels,components,created,resolutiondate,updated"
            },
            timeout=(8, 25),
            verify=False,
        )
        if target_resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Ticket {ticket_key} was not found in Jira")
        if target_resp.status_code in (401, 403):
            raise HTTPException(status_code=target_resp.status_code, detail="Jira authentication failed. Verify email/token permissions.")
        if target_resp.status_code != 200:
            raise HTTPException(status_code=target_resp.status_code, detail=f"Jira API error: {target_resp.text[:300]}")

        target_issue = target_resp.json()
        target_fields = target_issue.get("fields") or {}
        target = _extract_issue_text(target_fields)
        target_issue_url = f"{settings.url.rstrip('/')}/browse/{ticket_key}"

        # ── Use locally stored resolved tickets instead of live Jira search ──
        conn = sqlite3.connect('tickets.db')
        cursor = conn.cursor()
        local_query = '''
            SELECT jira_key, summary, status, priority, description,
                   jira_components, resolution_notes, labels
            FROM tickets
            WHERE LOWER(status) IN ('closed', 'resolved', 'done')
        '''
        local_conditions: list[str] = []
        local_params: list[Any] = []

        resolved_prefix = _resolve_key_prefix(settings.projectKey)
        local_conditions.append("jira_key LIKE ?")
        local_params.append(resolved_prefix)

        if lookback_days:
            cutoff = (datetime.utcnow() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
            local_conditions.append("substr(created_date, 1, 10) >= ?")
            local_params.append(cutoff)

        if local_conditions:
            local_query += " AND " + " AND ".join(local_conditions)

        local_query += " ORDER BY created_date DESC LIMIT ?"
        local_params.append(max_candidates)

        cursor.execute(local_query, local_params)
        local_rows = cursor.fetchall()
        conn.close()

        scored: list[dict[str, Any]] = []
        target_components = set((c or "").lower() for c in target.get("components", []))
        target_labels = set((l or "").lower() for l in target.get("labels", []))

        for row in local_rows:
            issue_key = str(row[0] or "").strip()
            if not issue_key or issue_key == ticket_key:
                continue

            cand_summary = str(row[1] or "").strip()
            cand_status = str(row[2] or "Unknown").strip()
            cand_priority = str(row[3] or "Unknown").strip()
            cand_description = str(row[4] or "").strip()
            cand_components_raw = str(row[5] or "")
            cand_components = [c.strip() for c in cand_components_raw.split(',') if c and c.strip()]
            cand_resolution = str(row[6] or "").strip()
            cand_labels_raw = str(row[7] or "")
            cand_labels_list = [l.strip() for l in cand_labels_raw.split(',') if l and l.strip()]

            cand_combined = f"{cand_summary} {cand_description} {' '.join(cand_labels_list)} {' '.join(cand_components)}"
            cand_token_set = _token_set(cand_combined)
            cand_summary_tokens = _token_set(cand_summary)

            content_sim = _jaccard_similarity(target["token_set"], cand_token_set)
            summary_sim = _jaccard_similarity(target["summary_tokens"], cand_summary_tokens)

            cand_comp_set = set(c.lower() for c in cand_components)
            cand_label_set = set(l.lower() for l in cand_labels_list)
            comp_sim = _jaccard_similarity(target_components, cand_comp_set)
            label_sim = _jaccard_similarity(target_labels, cand_label_set)

            score = (content_sim * 0.55) + (summary_sim * 0.20) + (comp_sim * 0.15) + (label_sim * 0.10)
            if (target.get("priority") or "").lower() == cand_priority.lower() and target.get("priority"):
                score = min(1.0, score + 0.05)

            if score < 0.12:
                continue

            top_approaches = _extract_action_lines(
                cand_resolution or "",
                max_items=4,
            )

            scored.append({
                "ticketKey": issue_key,
                "similarity": round(score, 3),
                "confidence": int(round(score * 100)),
                "summary": cand_summary,
                "status": cand_status,
                "priority": cand_priority,
                "resolvedAt": "",
                "components": cand_components,
                "labels": cand_labels_list,
                "resolutionSnippet": _trim(cand_resolution, 600),
                "topApproaches": top_approaches,
                "reference": f"{settings.url.rstrip('/')}/browse/{issue_key}" if issue_key else None,
                "rootCauseSignals": {
                    "commonComponents": sorted(list(target_components & cand_comp_set))[:4],
                    "commonLabels": sorted(list(target_labels & cand_label_set))[:4],
                    "knownRegressionWords": [
                        w for w in ["regression", "after upgrade", "post release", "deployment", "rollback"]
                        if w in (f"{cand_summary} {cand_description}".lower())
                    ],
                },
            })

        if not local_rows:
            assumptions.append("No resolved tickets found locally. Fetch tickets first from the Tickets tab.")

        scored.sort(key=lambda x: x["similarity"], reverse=True)
        unique_scored: list[dict[str, Any]] = []
        seen_scored_keys: set[str] = set()
        for item in scored:
            key = str(item.get("ticketKey") or "").strip()
            if not key or key in seen_scored_keys:
                continue
            seen_scored_keys.add(key)
            unique_scored.append(item)

        top_matches = unique_scored

        kb_query_text = _build_kb_query(target)
        kb_articles: list[dict[str, str]] = []
        kb_error: Optional[str] = None
        try:
            # Search title + text, scoped to configured Confluence spaces
            cql = _build_cql(kb_query_text, settings)
            kb_resp = requests.get(
                f"{settings.url.rstrip('/')}/wiki/rest/api/search",
                auth=auth,
                headers=headers,
                params={"cql": cql, "limit": kb_limit, "excerpt": "highlight"},
                timeout=(5, 10),
                verify=False,
            )
            if kb_resp.status_code == 200:
                kb_data = kb_resp.json()
                # base URL lives in the top-level _links, NOT per-result
                confluence_base = (
                    (kb_data.get("_links") or {}).get("base")
                    or f"{settings.url.rstrip('/')}/wiki"
                )
                for r in kb_data.get("results", []) or []:
                    title = (((r.get("content") or {}).get("title")) or "Untitled")
                    excerpt = re.sub(r"<[^>]+>", "", r.get("excerpt") or "").strip()
                    # webui path is inside content._links, not result-level _links
                    content_links = (r.get("content") or {}).get("_links") or {}
                    webui = content_links.get("webui") or r.get("url") or ""
                    url = f"{confluence_base}{webui}" if webui else confluence_base
                    kb_articles.append({
                        "title": title,
                        "url": url,
                        "excerpt": _trim(excerpt, 600),
                    })
            else:
                kb_error = f"Confluence search returned {kb_resp.status_code}"
        except Exception as kb_ex:
            kb_error = f"Confluence search failed: {str(kb_ex)}"

        actions: list[str] = []
        seen_actions: set[str] = set()

        for m in top_matches[:4]:
            for step in m.get("topApproaches", []):
                key = step.lower().strip()
                if key in seen_actions:
                    continue
                seen_actions.add(key)
                actions.append(step)
                if len(actions) >= 8:
                    break
            if len(actions) >= 8:
                break

        if not actions:
            actions = [
                "Collect error logs around first failure timestamp and compare with last known healthy run.",
                "Verify recent configuration, feature flags, and deployment changes for the impacted component.",
                "Ask customer for exact repro steps, user scope, and timezone-aligned timestamps.",
            ]

        workaround_candidates: list[str] = []
        confirmed_fixes: list[str] = []
        for m in top_matches[:5]:
            snippet = (m.get("resolutionSnippet") or "").lower()
            if any(k in snippet for k in ["workaround", "temporary", "restart", "rollback", "disable"]):
                workaround_candidates.append(m.get("resolutionSnippet") or "")
            if any(k in snippet for k in ["fixed", "resolved by", "patch", "upgraded", "permanent", "hotfix"]):
                confirmed_fixes.append(m.get("resolutionSnippet") or "")
        for kb in kb_articles[:4]:
            excerpt_low = (kb.get("excerpt") or "").lower()
            if any(k in excerpt_low for k in ["workaround", "temporary", "mitigation", "restart", "disable", "known issue"]):
                workaround_candidates.append(kb.get("excerpt") or "")
            if any(k in excerpt_low for k in ["fixed", "resolved", "patch", "upgrade", "permanent"]):
                confirmed_fixes.append(kb.get("excerpt") or "")

        workaround_candidates = [w for w in workaround_candidates if w]
        confirmed_fixes = [w for w in confirmed_fixes if w]

        recent_high_similarity = 0
        now_dt = datetime.utcnow()
        for m in top_matches:
            dt = _parse_iso_datetime(m.get("resolvedAt") or "")
            if dt and (now_dt - dt.replace(tzinfo=None)).days <= 14 and (m.get("similarity") or 0) >= 0.30:
                recent_high_similarity += 1

        component_frequency: dict[str, int] = {}
        for m in top_matches:
            for component in (m.get("components") or []):
                c = (component or "").strip()
                if c:
                    component_frequency[c] = component_frequency.get(c, 0) + 1
        common_component = max(component_frequency.items(), key=lambda x: x[1])[0] if component_frequency else None

        # ── Run deep root cause classification on the target ticket ──
        rca_result = _classify_root_cause(target)

        # Build enriched evidence combining RCA engine + similarity context
        rca_evidence = list(rca_result.get("keyIndicators", []))
        rca_evidence.append(f"{len(top_matches)} related resolved NCIPs found in the last {lookback_days} days.")
        if top_matches:
            rca_evidence.append(f"Top similar ticket confidence: {int(round(top_matches[0]['similarity'] * 100))}%.")
        if common_component:
            rca_evidence.append(f"Most common impacted component across similar tickets: {common_component}.")

        probable_root_cause = {
            "summary": rca_result.get("rootCauseCategory", "Unknown / Needs Investigation"),
            "hypothesis": rca_result.get("shortSummary", ""),
            "evidence": rca_evidence,
            "confidence": rca_result.get("confidence", 0),
            "scoreBreakdown": rca_result.get("scoreBreakdown", {}),
            "suggestedNextSteps": rca_result.get("suggestedNextSteps", []),
            "timelineSignals": {
                "recentSpikeCount14d": recent_high_similarity,
                "lookbackDays": lookback_days,
                "spikeLikely": recent_high_similarity >= 3,
            },
            "relatedTickets": [
                {
                    "ticketKey": m.get("ticketKey"),
                    "reference": m.get("reference"),
                    "confidence": m.get("confidence"),
                }
                for m in top_matches[:5]
            ],
        }

        logs_to_check = [
            {
                "service": common_component or "Primary application service",
                "fileOrSource": "application logs + error stream around first failure timestamp",
                "keywords": ["error", "exception", "timeout", "failed", "traceback", "rollback"],
            }
        ]

        troubleshooting_playbook = {
            "logsToCheck": logs_to_check,
            "questionsForCustomer": [
                "What exact timestamp (with timezone) did the issue first occur?",
                "Is the issue reproducible, and what are the exact steps?",
                "Is impact isolated to one tenant/environment/version or broad across customers?",
                "Did behavior change after a release, configuration change, or dependency update?",
            ],
            "configurationsToValidate": [
                "Recent deployment version and feature-flag changes for impacted module",
                "Service endpoint, authentication, and environment-specific configuration values",
                "Recent dependency/version upgrades and rollback history",
            ],
            "commandsOrQueries": [
                "Search logs for ticket key / correlation ID around first failure window",
                "Compare current config with last-known-good baseline",
                "Query recent resolved NCIPs filtered by same component and error keywords",
            ],
        }

        similar_duplicate_tickets = [
            {
                "ticketKey": m.get("ticketKey"),
                "summary": m.get("summary"),
                "status": m.get("status"),
                "priority": m.get("priority"),
                "similarityConfidence": m.get("confidence"),
                "reference": m.get("reference"),
                "matchingPatterns": {
                    "commonComponents": m.get("rootCauseSignals", {}).get("commonComponents", []),
                    "commonLabels": m.get("rootCauseSignals", {}).get("commonLabels", []),
                    "knownRegressionWords": m.get("rootCauseSignals", {}).get("knownRegressionWords", []),
                },
                "resolutionSnippet": m.get("resolutionSnippet"),
            }
            for m in top_matches
        ]

        risk_indicators = {
            "widespreadRisk": recent_high_similarity >= 3 or len(top_matches) >= 6,
            "trendSummary": (
                f"{recent_high_similarity} similar resolved incidents in the last 14 days."
                if recent_high_similarity > 0 else
                "No strong short-term spike detected in the last 14 days."
            ),
            "similarIssueVolume": len(top_matches),
            "increasingSignal": recent_high_similarity >= 3,
        }

        summary = [
            f"Analyzed {ticket_key if ticket_key else 'provided incident context'} against resolved NCIPs from the last {lookback_days} days.",
            f"Found {len(similar_duplicate_tickets)} similar/duplicate candidates and {len(kb_articles)} Knowledge Base references.",
            ("Potential widespread signal detected from recent similar cases." if risk_indicators["widespreadRisk"] else "No strong widespread trend detected based on recent history."),
        ]

        return {
            "status": "success",
            "input": {
                "ticketKey": ticket_key or None,
                "productModule": None,
                "ticketDescriptionProvided": False,
                "errorLogsProvided": False,
            },
            "summary": summary,
            "similarOrDuplicateTickets": similar_duplicate_tickets,
            "probableRootCause": probable_root_cause,
            "knowledgeBaseReferences": {
                "query": kb_query_text,
                "references": kb_articles,
                "note": kb_error,
            },
            "workarounds": {
                "confirmedFixes": list(dict.fromkeys(confirmed_fixes))[:5],
                "temporaryMitigations": list(dict.fromkeys(workaround_candidates))[:6],
            },
            "troubleshootingSteps": {
                "nextActions": actions[:8],
                "playbook": troubleshooting_playbook,
            },
            "riskIndicators": risk_indicators,
            "assumptions": assumptions,
            "raw": {
                "lookbackDays": lookback_days,
                "targetTicket": {
                    "ticketKey": ticket_key or None,
                    "reference": target_issue_url,
                    "summary": target.get("summary") or "",
                    "status": target.get("status") or "",
                    "priority": target.get("priority") or "",
                    "components": target.get("components") or [],
                    "labels": target.get("labels") or [],
                },
                "duplicateCandidates": top_matches,
                "knowledgeBase": {
                    "query": kb_query_text,
                    "articles": kb_articles,
                    "error": kb_error,
                },
            }
        }

    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Timed out while querying Jira/Confluence")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail="Cannot reach Jira/Confluence. Check URL/network.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resolution assistant failed: {str(e)}")


@app.post("/api/fetch-tickets")
async def fetch_tickets_from_jira(body: Optional[FetchTicketsRequest] = None):
    """
    Fetch tickets from Jira if credentials are provided,
    otherwise return sample data for demo purposes.
    Jira fetch runs in a background thread; returns immediately.
    Poll GET /api/fetch-status for progress.
    """
    
    # If Jira credentials provided, start background fetch
    if body and body.jiraSettings:
        if not _fetch_lock.acquire(blocking=False):
            return JSONResponse(
                status_code=409,
                content={"status": "busy", "message": "A fetch is already in progress. Poll /api/fetch-status for progress."},
            )
        # Reset status tracker
        _fetch_status["running"] = True
        _fetch_status["done"] = False
        _fetch_status["pages_fetched"] = 0
        _fetch_status["tickets_so_far"] = 0
        _fetch_status["error"] = None
        _fetch_status["result"] = None

        force = getattr(body, 'forceFullRefresh', False)
        settings_copy = body.jiraSettings

        def _background_fetch():
            try:
                result = _fetch_from_real_jira_sync(settings_copy, force)
                _fetch_status["result"] = result
            except Exception as exc:
                _fetch_status["error"] = str(exc)
                print(f"[fetch] background error: {exc}")
            finally:
                _fetch_status["running"] = False
                _fetch_status["done"] = True
                _fetch_lock.release()

        threading.Thread(target=_background_fetch, daemon=True).start()
        return {"status": "started", "message": "Fetch started in background. Poll /api/fetch-status for progress."}
    
    # No credentials: return sample demo data, but DO NOT
    # persist these into the main tickets database.
    try:
        sample_tickets = [
            {
                "key": "INC-001",
                "summary": "Database connection timeout",
                "status": "Open",
                "priority": "High",
                "created": "2026-03-13T10:00:00Z",
                "assignee": "unassigned",
                "description": "Users experiencing database connection timeouts in production environment. Connection pool exhausted during peak hours.",
                "component": "Database",
                "severity_score": 0.85,
                "routing_suggestion": "Engineering",
                "confidence_score": 0.92
            },
            {
                "key": "INC-002", 
                "summary": "Login page not loading",
                "status": "Open",
                "priority": "Medium",
                "created": "2026-03-13T11:30:00Z",
                "assignee": "unassigned",
                "description": "Several users report login page shows blank screen. Appears to be browser-specific issue affecting Chrome users.",
                "component": "Frontend",
                "severity_score": 0.65,
                "routing_suggestion": "Support",
                "confidence_score": 0.78
            },
            {
                "key": "INC-003",
                "summary": "Email notifications delayed",
                "status": "In Progress", 
                "priority": "Low",
                "created": "2026-03-13T09:15:00Z",
                "assignee": "john.doe@company.com",
                "description": "Email notifications are being delivered with 2-3 hour delay. SMTP server processing queue backup.",
                "component": "Email System",
                "severity_score": 0.35,
                "routing_suggestion": "Infrastructure",
                "confidence_score": 0.88
            },
            {
                "key": "INC-004",
                "summary": "Payment processing failures",
                "status": "Open",
                "priority": "Critical",
                "created": "2026-03-13T12:45:00Z",
                "assignee": "unassigned",
                "description": "Multiple payment transactions failing with gateway timeout errors. Revenue impact estimated at $50K/hour.",
                "component": "Payment Gateway",
                "severity_score": 0.95,
                "routing_suggestion": "Engineering",
                "confidence_score": 0.96
            },
            {
                "key": "INC-005",
                "summary": "Mobile app crashes on startup",
                "status": "Open", 
                "priority": "Medium",
                "created": "2026-03-13T08:30:00Z",
                "assignee": "unassigned", 
                "description": "iOS app version 2.1.3 crashes immediately after splash screen. Affects users who updated in the last 24 hours.",
                "component": "Mobile App",
                "severity_score": 0.70,
                "routing_suggestion": "Engineering",
                "confidence_score": 0.85
            }
        ]

        return {
            "status": "success",
            "message": f"Successfully fetched {len(sample_tickets)} tickets",
            "count": len(sample_tickets),
            "tickets": sample_tickets
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch tickets: {str(e)}")

def _extract_adf_text(adf) -> str:
    """
    Recursively extract plain text from Atlassian Document Format (ADF).
    Jira API v3 returns description as ADF JSON, not plain text.
    """
    if not adf:
        return ""
    if isinstance(adf, str):
        return adf
    if isinstance(adf, dict):
        node_type = adf.get("type", "")
        # Text leaf node
        if node_type == "text":
            return adf.get("text", "")
        # Recurse into content array
        content = adf.get("content", [])
        parts = [_extract_adf_text(child) for child in content]
        separator = "\n" if node_type in ("paragraph", "heading", "bulletList", "listItem", "blockquote") else " "
        return separator.join(p for p in parts if p).strip()
    if isinstance(adf, list):
        return " ".join(_extract_adf_text(item) for item in adf)
    return ""


def _fetch_from_real_jira_sync(settings: JiraSettings, force_full: bool = False):
    """Internal helper: call real Jira API with provided credentials.
    
    Runs synchronously (called via asyncio.to_thread) so it can use the
    pooled requests.Session without blocking the event loop.
    
    Performs an **incremental** fetch by default: only tickets created or
    updated since the most-recent ticket already stored locally.  On the
    first-ever fetch (empty DB) or when *force_full* is True the full
    date-range is pulled.
    """
    try:
        import time as _t
        fetch_start = _t.monotonic()

        # Use the newer Jira search API path; the old /rest/api/3/search
        # returns HTTP 410 and instructs to migrate to /rest/api/3/search/jql.
        jira_url = f"{settings.url.rstrip('/')}/rest/api/3/search/jql"

        days_back = getattr(settings, 'daysBack', 30)
        project_prefix = _resolve_key_prefix(settings.projectKey)

        # ── Build JQL ──
        # Always fetch the full daysBack window so local DB exactly
        # mirrors what Jira returns for the same query.  No incremental
        # mode — it caused stale tickets to accumulate and counts to drift.
        if getattr(settings, 'jql', None):
            jql = settings.jql  # type: ignore[assignment]
        else:
            jql = (
                f'project = {settings.projectKey} '
                f'AND created >= -{days_back}d '
                f'ORDER BY created DESC'
            )
        print(f"[fetch] FULL mode — fetching last {days_back} days, JQL: {jql}")
        
        # Jira API request basics
        auth = HTTPBasicAuth(settings.email, settings.apiToken)
        headers = {
            "Accept": "application/json"
        }

        # ── Step 1: Discover NCI Severity field ID (cached for 10 minutes) ──
        nci_severity_field_id: Optional[str] = None
        cache_key = f"{settings.url.rstrip('/')}|{settings.projectKey}|{settings.email}"
        if JIRA_FIELD_CACHE.get("key") == cache_key and float(JIRA_FIELD_CACHE.get("expiresAt") or 0.0) > time.time():
            nci_severity_field_id = JIRA_FIELD_CACHE.get("nciSeverityFieldId")
        else:
            try:
                _jira_session.auth = auth
                field_resp = _jira_session.get(
                    f"{settings.url.rstrip('/')}/rest/api/3/field",
                    headers=headers,
                    timeout=(8, 15),
                )
                if field_resp.status_code == 200:
                    all_fields = field_resp.json()
                    for f in all_fields:
                        fname = (f.get("name") or "").lower()
                        if "nci severity" in fname or fname == "severity":
                            nci_severity_field_id = f.get("id")
                            break
            except Exception:
                nci_severity_field_id = None
            JIRA_FIELD_CACHE["key"] = cache_key
            JIRA_FIELD_CACHE["nciSeverityFieldId"] = nci_severity_field_id
            JIRA_FIELD_CACHE["expiresAt"] = time.time() + 600

        # ── Step 2: Fetch all pages of tickets ──
        # Jira Cloud /search/jql supports BOTH cursor pagination (nextPageToken)
        # AND offset pagination (startAt / total).  We handle all combinations:
        #   - If response contains nextPageToken  → cursor mode (preferred)
        #   - If response contains isLast == True → stop
        #   - Otherwise fall back to startAt + total
        all_issues: list[dict[str, Any]] = []
        seen_issue_keys: set[str] = set()
        page_size = 100   # Jira Cloud hard cap per request
        # Safety cap is configurable; set JIRA_MAX_FETCH_ISSUES=0 for unlimited.
        # Default is high enough to avoid undercounting larger 180-day windows.
        max_fetch_issues_env = os.getenv("JIRA_MAX_FETCH_ISSUES", "10000")
        try:
            max_fetch_issues = int(max_fetch_issues_env)
        except ValueError:
            max_fetch_issues = 10000
        if max_fetch_issues < 0:
            max_fetch_issues = 10000
        max_fetch_issues_limit: Optional[int] = max_fetch_issues if max_fetch_issues > 0 else None
        start_at = 0
        # Explicitly name required fields — /search/jql ignores *all* for custom fields
        base_fields = ["summary", "status", "priority", "assignee", "created",
                       "components", "description", "labels", "resolution", "resolutiondate", "comment", "issuetype"]
        if nci_severity_field_id:
            base_fields.append(nci_severity_field_id)
        FIELDS = ",".join(base_fields)
        next_page_token: Optional[str] = None
        page_num = 0

        while True:
            page_num += 1
            params: dict[str, Any] = {
                "jql": jql,
                "maxResults": page_size,
                "fields": FIELDS,
            }
            # Cursor pagination (nextPageToken) and offset pagination
            # (startAt) are mutually exclusive in Jira Cloud's /search/jql.
            # Sending both can cause Jira to skip or repeat issues.
            if next_page_token:
                params["nextPageToken"] = next_page_token
            else:
                params["startAt"] = start_at

            _jira_session.auth = auth
            response = _jira_session.get(
                jira_url,
                headers=headers,
                params=params,
                timeout=(8, 30),
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Jira API error: {response.text}",
                )

            data = response.json()
            issues = data.get("issues", []) or []
            total_reported = data.get("total", 0)
            is_last = data.get("isLast", None)
            next_page_token = data.get("nextPageToken") or None

            print(f"[fetch] page {page_num}: got {len(issues)} issues, total_reported={total_reported}, "
                  f"isLast={is_last}, nextPageToken={'yes' if next_page_token else 'no'}, "
                  f"accumulated={len(all_issues)}")

            # Update live progress for the status endpoint
            _fetch_status["pages_fetched"] = page_num
            _fetch_status["tickets_so_far"] = len(all_issues)

            if not issues:
                break

            new_in_page = 0
            for issue in issues:
                issue_key = str(issue.get("key") or "").strip()
                if not issue_key or issue_key in seen_issue_keys:
                    continue
                seen_issue_keys.add(issue_key)
                all_issues.append(issue)
                new_in_page += 1
                if max_fetch_issues_limit is not None and len(all_issues) >= max_fetch_issues_limit:
                    break
            if max_fetch_issues_limit is not None and len(all_issues) >= max_fetch_issues_limit:
                print(f"[fetch] reached safety cap of {max_fetch_issues_limit} issues")
                break
            start_at += len(issues)

            # Stop conditions (checked in priority order)
            if is_last is True:
                print(f"[fetch] Jira reported isLast=True, stopping at {len(all_issues)} issues")
                break
            if next_page_token:
                # Cursor mode: keep looping; token already set for next params
                continue
            # Offset mode: if we got a full page of results, there are
            # likely more pages — keep going regardless of total_reported.
            # Jira Cloud sometimes caps the 'total' field (e.g. at 500)
            # even when more issues exist.
            if len(issues) >= page_size:
                # Got a full page — probably more to fetch
                continue
            # Got a partial page (< page_size) — this was the last page
            print(f"[fetch] partial page ({len(issues)} < {page_size}), stopping at {len(all_issues)} issues")
            break

        print(f"[fetch] DONE: total fetched = {len(all_issues)} issues in {page_num} pages "
              f"(Jira reported total = {total_reported})")

        # Process and store tickets
        tickets = []
        conn = sqlite3.connect('tickets.db')
        cursor = conn.cursor()

        # Clean up any demo/sample tickets that may have been
        # inserted earlier (keys like INC-001, INC-002, ...).
        cursor.execute("DELETE FROM tickets WHERE jira_key LIKE 'INC-%'")

        # Wipe existing project tickets before re-inserting the fresh set
        # from Jira.  This guarantees the local DB count matches Jira exactly.
        cursor.execute("DELETE FROM tickets WHERE jira_key LIKE ?", (project_prefix,))

        for issue in all_issues:
            fields = issue.get("fields") or {}

            # Components from Jira (used as Product name when no dedicated
            # product field exists) and also exposed separately as
            # jira_components.
            raw_components = fields.get("components") or []
            component_names = [
                c.get("name")
                for c in raw_components
                if isinstance(c, dict) and c.get("name")
            ]
            jira_components = ", ".join(component_names) if component_names else None
            product_name = component_names[0] if component_names else None

            # Priority: try NCI Severity field (auto-discovered), then scan all
            # custom fields for known NCI values, then fall back to built-in priority.
            NCI_VALUES = {"blocker", "critical", "major", "moderate"}

            def _extract_field_value(raw: Any) -> Optional[str]:
                if raw is None:
                    return None
                if isinstance(raw, dict):
                    return raw.get("value") or raw.get("name") or str(raw.get("id", "")) or None
                if isinstance(raw, list):
                    parts = []
                    for item in raw:
                        v = _extract_field_value(item)
                        if v:
                            parts.append(v)
                    return ", ".join(parts) if parts else None
                s = str(raw).strip()
                return s if s else None

            priority_value: Optional[str] = None

            # 1. Use discovered NCI Severity field ID
            if nci_severity_field_id:
                priority_value = _extract_field_value(fields.get(nci_severity_field_id))

            # 2. Scan ALL custom fields for a value matching NCI severity levels
            if not priority_value:
                for k, v in fields.items():
                    if k.startswith("customfield") and v not in (None, [], {}, ""):
                        extracted = _extract_field_value(v)
                        if extracted and extracted.lower() in NCI_VALUES:
                            priority_value = extracted
                            print(f"[priority] found NCI value '{extracted}' in field {k} for {issue.get('key')}")
                            break

            # 3. Fall back to Jira built-in priority
            if not priority_value:
                p = fields.get("priority")
                bp = (p.get("name") if isinstance(p, dict) else str(p)) if p else None
                # Treat Jira "Undefined" / None as Unset — don't store noisy defaults
                if bp and bp.lower() not in ("undefined", "unknown", "none", ""):
                    priority_value = bp

            if not priority_value:
                priority_value = "Unset"

            status_raw = fields.get("status")
            status_name = (status_raw.get("name") if isinstance(status_raw, dict) else str(status_raw)) if status_raw else "Unknown"

            assignee_raw = fields.get("assignee")
            if isinstance(assignee_raw, dict):
                assignee_val = (
                    assignee_raw.get("emailAddress")
                    or assignee_raw.get("displayName")
                    or "unassigned"
                )
            else:
                assignee_val = "unassigned"

            # Extract resolution notes: resolution name + last meaningful comment + PR URLs
            resolution_raw = fields.get("resolution")
            resolution_name: Optional[str] = None
            if isinstance(resolution_raw, dict):
                resolution_name = resolution_raw.get("name") or None
            elif isinstance(resolution_raw, str):
                resolution_name = resolution_raw.strip() or None

            # Skip generic single-word resolution names — not useful on their own
            _generic = {"fixed", "done", "resolved", "closed", "won't fix", "wontfix",
                        "duplicate", "incomplete", "cannot reproduce", "unresolved"}
            resolution_label = resolution_name if resolution_name and resolution_name.lower() not in _generic else None

            # Pull recent comments, strip routing/workflow tags, keep meaningful technical context
            pr_links: list[str] = []
            resolution_summary = ""
            comment_obj = fields.get("comment") or {}
            comment_list = comment_obj.get("comments", []) if isinstance(comment_obj, dict) else []
            focused_comments = comment_list[-12:] if comment_list else []

            def _clean_comment(raw: str) -> str:
                # Remove #HASHTAG# style internal routing tags (e.g. #SENDTOSF# #SFALL#)
                cleaned = re.sub(r'#[A-Z0-9_]+#', '', raw)
                # Remove bare hashtag words like #movetosupport
                cleaned = re.sub(r'#\w+', '', cleaned)
                # Remove markdown heading markers
                cleaned = re.sub(r'(?m)^\s*#+\s*', '', cleaned)
                # Remove workflow/status update lines that do not describe a fix
                cleaned = re.sub(r'(?i)\bnew\s+ticket\s+status\s*:\s*[a-z\s_-]+\b', '', cleaned)
                cleaned = re.sub(r'(?i)\bstatus\s*(?:changed|updated)?\s*:?\s*(?:to\s*)?[a-z\s_-]+\b', '', cleaned)
                # Collapse whitespace
                cleaned = re.sub(r'\s+', ' ', cleaned).strip()
                return cleaned

            def _is_noise_comment(text: str) -> bool:
                lower = text.lower().strip()
                if len(lower) < 20:
                    return True
                noise_phrases = [
                    "new ticket status",
                    "status changed",
                    "status updated",
                    "ticket transitioned",
                    "moved to",
                    "workflow",
                    "automation",
                    "auto-transition",
                    "assigned to",
                    "labels updated",
                    "priority changed",
                ]
                if any(phrase in lower for phrase in noise_phrases):
                    return True
                if re.fullmatch(r'(open|closed|resolved|done|in progress|reopened)', lower):
                    return True
                return False

            def _is_close_request_comment(text: str) -> bool:
                lower = text.lower().strip()
                close_request_phrases = [
                    "please close",
                    "can you close",
                    "close this ticket",
                    "close this ncip",
                    "issue is resolved can you",
                    "kindly close",
                    "mark this as closed",
                ]
                return any(phrase in lower for phrase in close_request_phrases)

            def _is_low_signal_comment(text: str) -> bool:
                lower = text.lower().strip()
                low_signal_phrases = [
                    "issue is resolved",
                    "resolved now",
                    "working now",
                    "please check",
                    "thanks",
                    "thank you",
                    "closing this",
                ]
                if any(phrase in lower for phrase in low_signal_phrases) and len(lower) < 120:
                    return True
                return False

            # Keywords that indicate a comment is explaining the resolution/fix
            _solution_keywords = [
                "fixed", "resolved", "solution", "workaround", "root cause",
                "caused by", "issue was", "problem was", "we found", "we applied",
                "we deployed", "patch", "hotfix", "rollback", "configuration",
                "closed because", "closing this", "restarted", "reprovisioned",
                "rotated", "updated", "upgraded", "reverted", "disabled", "enabled",
                "the fix", "has been fixed", "was due to", "turned out",
            ]

            def _solution_score(text: str) -> int:
                lower = text.lower()
                return sum(1 for kw in _solution_keywords if kw in lower)

            _technical_keywords = [
                "exception", "timeout", "latency", "stack trace", "error", "failed",
                "service", "database", "query", "deployment", "build", "release",
                "pipeline", "endpoint", "api", "cache", "memory", "cpu", "network",
                "dns", "config", "configuration", "certificate", "token", "auth",
                "restart", "restarted", "rollback", "patch", "fix", "mitigation",
            ]

            def _technical_score(text: str) -> int:
                lower = text.lower()
                keyword_hits = sum(1 for kw in _technical_keywords if kw in lower)
                url_hits = 2 if re.search(r'https?://', text, re.IGNORECASE) else 0
                return keyword_hits + _solution_score(text) + url_hits

            def _truncate(text: str, max_chars: int = 1200) -> str:
                if len(text) <= max_chars:
                    return text
                # Try to cut at sentence boundary
                cut = text[:max_chars]
                last_period = max(cut.rfind('. '), cut.rfind('.\n'))
                return (cut[:last_period + 1] if last_period > 50 else cut) + "…"

            candidates: list[dict[str, Any]] = []
            for idx, com in enumerate(focused_comments):
                body = _extract_adf_text(com.get("body") or "")
                if not body:
                    continue
                cleaned = _clean_comment(body)
                if _is_noise_comment(cleaned):
                    # Skip comments that are tags/workflow/status boilerplate
                    continue
                # Extract GitHub / Bitbucket / GitLab PR URLs from original body
                found_urls = re.findall(
                    r'https?://[^\s<>"]+/(?:pull(?:s)?|merge_requests|PR)/[^\s<>"]+',
                    body, re.IGNORECASE
                )
                pr_links.extend(found_urls)

                has_pr_link = len(found_urls) > 0
                tech_score = _technical_score(cleaned)
                is_close_request = _is_close_request_comment(cleaned)
                is_low_signal = _is_low_signal_comment(cleaned)

                # Ignore non-technical "please close" style comments unless they carry PR evidence
                if is_close_request and not has_pr_link and tech_score < 2:
                    continue
                if is_low_signal and not has_pr_link and tech_score < 3:
                    continue

                candidates.append({
                    "index": idx,
                    "text": cleaned,
                    "score": tech_score + (3 if has_pr_link else 0),
                    "has_pr": has_pr_link,
                })

            # Build resolution summary from strongest evidence comments (or PR-bearing comments first)
            if candidates:
                pr_candidates = [c for c in candidates if c["has_pr"]]
                informative_candidates = [c for c in candidates if c["has_pr"] or int(c.get("score") or 0) >= 3]
                source_pool = pr_candidates if pr_candidates else (informative_candidates or candidates)
                ranked = sorted(
                    source_pool,
                    key=lambda item: (item["score"], item["index"]),
                    reverse=True,
                )

                picked_items: list[dict[str, Any]] = []
                seen_keys: set[str] = set()
                for item in ranked:
                    text = str(item["text"] or "").strip()
                    if not text:
                        continue
                    dedupe_key = re.sub(r'\s+', ' ', text.lower())
                    if dedupe_key in seen_keys:
                        continue
                    seen_keys.add(dedupe_key)
                    picked_items.append({
                        "index": int(item["index"]),
                        "text": _truncate(text, 1200),
                    })
                    if len(picked_items) >= 3:
                        break

                if picked_items:
                    # Present selected comments in timeline order for readable closure rationale
                    ordered = [p["text"] for p in sorted(picked_items, key=lambda x: x["index"])]
                    if len(ordered) == 1:
                        resolution_summary = ordered[0]
                    else:
                        resolution_summary = "Resolution Summary:\n" + "\n".join(f"- {line}" for line in ordered)
                elif resolution_label:
                    resolution_summary = f"No actionable technical resolution details found in comments. ({resolution_label})"

            # Build rich resolution notes
            parts: list[str] = []
            if resolution_label:
                parts.append(f"Resolution: {resolution_label}")
            if resolution_summary and len(resolution_summary) > 20:
                parts.append(resolution_summary)
            if pr_links:
                parts.append("PR/MR: " + " | ".join(dict.fromkeys(pr_links)))
            resolution_notes: Optional[str] = "\n".join(parts) if parts else (resolution_label or None)

            # Labels
            labels_list = fields.get("labels") or []
            labels_csv = ", ".join(str(l) for l in labels_list if l) if labels_list else None

            # Issue type (Bug, Task, Story, Epic, etc.)
            issuetype_raw = fields.get("issuetype")
            issue_type_val = None
            if isinstance(issuetype_raw, dict):
                issue_type_val = issuetype_raw.get("name") or None
            elif isinstance(issuetype_raw, str):
                issue_type_val = issuetype_raw.strip() or None

            ticket = {
                "key": issue.get("key", ""),
                "summary": fields.get("summary") or "",
                "status": status_name,
                "priority": priority_value,
                "created": fields.get("created") or "",
                "assignee": assignee_val,
                "description": _extract_adf_text(fields.get("description", "")),
                "jira_components": jira_components,
                "product_name": product_name,
                "resolution_notes": resolution_notes,
                "labels": labels_csv,
                "issue_type": issue_type_val,
            }
            
            tickets.append(ticket)
        
        # Batch-insert all tickets at once (much faster than per-row inserts)
        if tickets:
            cursor.executemany('''
                INSERT OR REPLACE INTO tickets 
                (jira_key, summary, status, priority, created_date, assignee, description, jira_components, product_name, resolution_notes, labels, issue_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', [
                (
                    t["key"], t["summary"], t["status"], t["priority"],
                    t["created"], t["assignee"], t["description"],
                    t["jira_components"], t["product_name"],
                    t["resolution_notes"], t.get("labels"), t.get("issue_type"),
                )
                for t in tickets
            ])
        conn.commit()

        # Get the total count of tickets in DB for this project
        # Derive the real key prefix from fetched tickets, falling back to the
        # configured projectKey (Jira project name and key prefix can differ).
        real_prefix = project_prefix
        if tickets:
            first_key = tickets[0].get("key", "")
            dash_idx = first_key.find("-")
            if dash_idx > 0:
                real_prefix = f"{first_key[:dash_idx]}-%"

        # Count what we just inserted — should match Jira's total exactly
        # since we wiped and re-inserted from the fresh fetch.
        cursor_count = conn.cursor()
        cursor_count.execute("SELECT COUNT(*) FROM tickets WHERE jira_key LIKE ?", (real_prefix,))
        total_in_db = cursor_count.fetchone()[0] or 0
        conn.close()

        # Invalidate cached duplicate-candidate response after ticket refresh
        DUPLICATE_CANDIDATE_CACHE["key"] = None
        DUPLICATE_CANDIDATE_CACHE["value"] = None
        DUPLICATE_CANDIDATE_CACHE["expiresAt"] = 0.0

        elapsed = round(_t.monotonic() - fetch_start, 1)
        fetched_count = len(tickets)
        print(f"[fetch] complete: {fetched_count} from Jira, {total_in_db} in DB, "
              f"Jira reported total={total_reported}, took {elapsed}s")
        
        return {
            "status": "success",
            "message": f"Fetched {fetched_count} tickets from Jira. {total_in_db} total in database.",
            "count": total_in_db,
            "jira_total": total_reported,
            "fetched": fetched_count,
            "elapsed_seconds": elapsed,
            "tickets": [],  # omit full payload; frontend reads from /api/tickets
        }
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Failed to connect to Jira: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch tickets: {str(e)}")


@app.get("/api/fetch-status")
async def get_fetch_status():
    """Poll this endpoint to get live progress of a background Jira fetch."""
    return {
        "running": _fetch_status["running"],
        "done": _fetch_status["done"],
        "pages_fetched": _fetch_status["pages_fetched"],
        "tickets_so_far": _fetch_status["tickets_so_far"],
        "error": _fetch_status["error"],
        "result": _fetch_status["result"],
    }


@app.get("/api/tickets")
async def get_stored_tickets(
    projectKey: Optional[str] = Query(default=None),
    daysBack: Optional[int] = Query(default=None, ge=1),
):
    """Get all stored tickets from database"""
    try:
        conn = sqlite3.connect('tickets.db')
        cursor = conn.cursor()
        
        query = '''
            SELECT jira_key, summary, status, priority, created_date, assignee, description,
                   jira_components, product_name,
                   component, severity_score, routing_suggestion, confidence_score, issue_type
            FROM tickets
        '''

        conditions: list[str] = []
        params: list[Any] = []

        if projectKey:
            conditions.append("jira_key LIKE ?")
            params.append(_resolve_key_prefix(projectKey))

        if daysBack:
            # Compute cutoff as a plain YYYY-MM-DD string so the
            # comparison works reliably against any ISO-8601 variant
            # stored in created_date (with or without timezone suffix).
            cutoff = (datetime.utcnow() - timedelta(days=daysBack)).strftime("%Y-%m-%d")
            conditions.append("substr(created_date, 1, 10) >= ?")
            params.append(cutoff)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY created_date DESC"

        cursor.execute(query, params)
        
        rows = cursor.fetchall()
        conn.close()
        
        tickets = []
        for row in rows:
            tickets.append({
                "key": row[0],
                "summary": row[1], 
                "status": row[2],
                "priority": row[3],
                "created": row[4],
                "assignee": row[5],
                "description": row[6],
                "jira_components": row[7],
                "product_name": row[8],
                "component": row[9],
                "severity_score": row[10],
                "routing_suggestion": row[11], 
                "confidence_score": row[12],
                "issue_type": row[13]
            })
        
        return {
            "status": "success",
            "count": len(tickets),
            "tickets": tickets
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get tickets: {str(e)}")


@app.get("/api/duplicate-candidates")
async def get_duplicate_candidates(
    projectKey: Optional[str] = Query(default=None),
    daysBack: Optional[int] = Query(default=180, ge=1),
    minConfidence: Optional[int] = Query(default=40, ge=1, le=100),
    limit: Optional[int] = Query(default=100, ge=1, le=500),
):
    """Return probable duplicate/similar tickets from locally stored ticket history."""
    try:
        normalized_project = (projectKey or "").upper().strip()
        normalized_days = int(daysBack or 180)
        normalized_min_confidence = int(minConfidence or 40)
        normalized_limit = int(limit or 100)

        cache_key = f"{normalized_project}|{normalized_days}|{normalized_min_confidence}|{normalized_limit}"
        now_ts = time.time()
        if (
            DUPLICATE_CANDIDATE_CACHE.get("key") == cache_key
            and now_ts < float(DUPLICATE_CANDIDATE_CACHE.get("expiresAt") or 0)
            and isinstance(DUPLICATE_CANDIDATE_CACHE.get("value"), dict)
        ):
            return DUPLICATE_CANDIDATE_CACHE["value"]

        conn = sqlite3.connect('tickets.db')
        cursor = conn.cursor()

        query = '''
            SELECT jira_key, summary, status, priority, description, jira_components, created_date, resolution_notes, labels
            FROM tickets
        '''
        conditions: list[str] = []
        params: list[Any] = []

        if normalized_project:
            conditions.append("jira_key LIKE ?")
            params.append(_resolve_key_prefix(normalized_project))

        if normalized_days:
            cutoff = (datetime.utcnow() - timedelta(days=normalized_days)).strftime("%Y-%m-%d")
            conditions.append("substr(created_date, 1, 10) >= ?")
            params.append(cutoff)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY created_date DESC"

        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        if not rows:
            return {
                "status": "success",
                "count": 0,
                "tickets": [],
            }

        tickets: list[dict[str, Any]] = []
        for row in rows:
            jira_key = str(row[0] or "").strip()
            summary = str(row[1] or "").strip()
            status = str(row[2] or "Unknown").strip() or "Unknown"
            priority = str(row[3] or "Unknown").strip() or "Unknown"
            description = str(row[4] or "").strip()
            components_raw = str(row[5] or "")
            components = [c.strip() for c in components_raw.split(',') if c and c.strip()]
            resolution_notes = str(row[7] or "").strip() if row[7] else ""
            labels_raw = str(row[8] or "") if len(row) > 8 and row[8] else ""
            labels = [l.strip() for l in labels_raw.split(',') if l and l.strip()]

            full_text = f"{summary} {description} {' '.join(components)}"

            tickets.append({
                "key": jira_key,
                "summary": summary,
                "status": status,
                "priority": priority,
                "description": description,
                "components": components,
                "labels": labels,
                "resolution_notes": resolution_notes,
                "token_set": _token_set(full_text),
                "summary_tokens": _token_set(summary),
            })

        threshold = normalized_min_confidence / 100.0
        best_match_by_key: dict[str, dict[str, Any]] = {}

        # Candidate blocking: compare tickets only within lightweight shared buckets
        # (components + first summary tokens) to avoid full O(n^2) comparisons.
        buckets: dict[str, list[int]] = defaultdict(list)
        for index, ticket in enumerate(tickets):
            summary_tokens = list(ticket.get("summary_tokens") or [])
            for token in sorted(summary_tokens)[:3]:
                buckets[f"tok:{token}"].append(index)
            components = [str(c or "").lower().strip() for c in (ticket.get("components") or []) if str(c or "").strip()]
            for component in components[:3]:
                buckets[f"cmp:{component}"] .append(index)

        candidate_pairs: set[tuple[int, int]] = set()
        for indices in buckets.values():
            if len(indices) < 2:
                continue
            # Guard against very large buckets creating explosive pair counts.
            if len(indices) > 220:
                indices = indices[:220]
            for left_pos in range(len(indices)):
                left_idx = indices[left_pos]
                for right_pos in range(left_pos + 1, len(indices)):
                    right_idx = indices[right_pos]
                    if left_idx < right_idx:
                        candidate_pairs.add((left_idx, right_idx))
                    else:
                        candidate_pairs.add((right_idx, left_idx))

        if not candidate_pairs and len(tickets) >= 2:
            # Fallback for sparse/atypical data: small rolling window only.
            max_window = min(len(tickets), 80)
            for i in range(max_window):
                for j in range(i + 1, max_window):
                    candidate_pairs.add((i, j))

        for i, j in candidate_pairs:
            left = tickets[i]
            right = tickets[j]

            summary_sim = _jaccard_similarity(left["summary_tokens"], right["summary_tokens"])
            content_sim = _jaccard_similarity(left["token_set"], right["token_set"])

            left_components = set(c.lower() for c in left.get("components", []))
            right_components = set(c.lower() for c in right.get("components", []))
            comp_sim = _jaccard_similarity(left_components, right_components)

            left_labels = set(l.lower() for l in left.get("labels", []))
            right_labels = set(l.lower() for l in right.get("labels", []))
            label_sim = _jaccard_similarity(left_labels, right_labels)

            score = (summary_sim * 0.50) + (content_sim * 0.30) + (comp_sim * 0.10) + (label_sim * 0.10)
            if score < threshold:
                continue

            confidence = int(round(score * 100))
            left_components_list = sorted(
                list({str(c or "").strip() for c in (left.get("components") or []) if str(c or "").strip()})
            )
            right_components_list = sorted(
                list({str(c or "").strip() for c in (right.get("components") or []) if str(c or "").strip()})
            )

            # Compute common labels and regression hints between pairs
            common_labels_set = left_labels & right_labels
            common_labels_left = sorted(list({l for l in (left.get("labels") or []) if l.lower() in common_labels_set}))[:6]
            common_labels_right = sorted(list({l for l in (right.get("labels") or []) if l.lower() in common_labels_set}))[:6]

            _regression_words = ["regression", "after upgrade", "post release", "deployment", "rollback", "after update", "post-deployment"]
            def _find_regression_words(ticket: dict) -> list[str]:
                text = f"{ticket.get('summary', '')} {ticket.get('description', '')}".lower()
                return [w for w in _regression_words if w in text]

            def _resolution_snippet(primary: dict, paired: dict) -> str:
                res = (primary.get("resolution_notes") or "").strip()
                pairing_note = f"Similar to {paired['key']}: {paired['summary']}"
                if res and res.lower() not in ("done", "fixed", "won't fix", "duplicate", "incomplete", "cannot reproduce"):
                    return _trim(res, 300)
                elif res:
                    return _trim(f"{res}. {pairing_note}", 300)
                return _trim(pairing_note, 220)

            left_item = {
                "ticketKey": left["key"],
                "summary": left["summary"],
                "status": left["status"],
                "priority": left["priority"],
                "similarityConfidence": confidence,
                "reference": None,
                "resolutionNotes": left.get("resolution_notes") or "",
                "matchingPatterns": {
                    "commonComponents": left_components_list,
                    "commonLabels": common_labels_left,
                    "knownRegressionWords": _find_regression_words(left),
                },
                "resolutionSnippet": _resolution_snippet(left, right),
            }

            right_item = {
                "ticketKey": right["key"],
                "summary": right["summary"],
                "status": right["status"],
                "priority": right["priority"],
                "similarityConfidence": confidence,
                "reference": None,
                "resolutionNotes": right.get("resolution_notes") or "",
                "matchingPatterns": {
                    "commonComponents": right_components_list,
                    "commonLabels": common_labels_right,
                    "knownRegressionWords": _find_regression_words(right),
                },
                "resolutionSnippet": _resolution_snippet(right, left),
            }

            existing_left = best_match_by_key.get(left["key"])
            if not existing_left or confidence > int(existing_left.get("similarityConfidence") or 0):
                best_match_by_key[left["key"]] = left_item

            existing_right = best_match_by_key.get(right["key"])
            if not existing_right or confidence > int(existing_right.get("similarityConfidence") or 0):
                best_match_by_key[right["key"]] = right_item

        ranked = sorted(
            best_match_by_key.values(),
            key=lambda item: int(item.get("similarityConfidence") or 0),
            reverse=True,
        )

        response_payload = {
            "status": "success",
            "count": len(ranked[: normalized_limit]),
            "tickets": ranked[: normalized_limit],
        }
        DUPLICATE_CANDIDATE_CACHE["key"] = cache_key
        DUPLICATE_CANDIDATE_CACHE["value"] = response_payload
        DUPLICATE_CANDIDATE_CACHE["expiresAt"] = time.time() + 30.0
        return response_payload

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute duplicate candidates: {str(e)}")


# ── Confluence spaces listing ────────────────────────────────────────────────

@app.post("/api/confluence-spaces")
async def list_confluence_spaces(settings: JiraSettings):
    """
    List available Confluence spaces using the Confluence REST API.

    Atlassian Cloud exposes spaces at /wiki/rest/api/space.
    Falls back to the v2 API (/wiki/api/v2/spaces) if the v1 endpoint fails.
    """
    if not settings.url or not settings.email or not settings.apiToken:
        raise HTTPException(status_code=400, detail="Jira URL, email, and API token are required.")

    auth = HTTPBasicAuth(settings.email, settings.apiToken)
    headers = {"Accept": "application/json"}
    base_url = settings.url.rstrip("/")

    spaces: list[dict[str, str]] = []

    # ── Try Confluence Cloud v1 REST API ──────────────────────────────────
    try:
        url_v1 = f"{base_url}/wiki/rest/api/space"
        resp = _jira_session.get(
            url_v1,
            auth=auth,
            headers=headers,
            params={"type": "global", "limit": 200, "status": "current"},
            timeout=(8, 20),
        )
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("results") or []
            for sp in results:
                key = (sp.get("key") or "").strip()
                name = (sp.get("name") or "").strip()
                if key:
                    spaces.append({"key": key, "name": name or key})
            if spaces:
                return {"status": "success", "spaces": spaces}
    except Exception:
        pass  # fall through to v2

    # ── Fallback: Confluence Cloud v2 API ─────────────────────────────────
    try:
        url_v2 = f"{base_url}/wiki/api/v2/spaces"
        resp2 = _jira_session.get(
            url_v2,
            auth=auth,
            headers=headers,
            params={"limit": 200, "status": "current", "sort": "name"},
            timeout=(8, 20),
        )
        if resp2.status_code == 200:
            data2 = resp2.json()
            results2 = data2.get("results") or []
            for sp in results2:
                key = (sp.get("key") or "").strip()
                name = (sp.get("name") or "").strip()
                if key:
                    spaces.append({"key": key, "name": name or key})
            if spaces:
                return {"status": "success", "spaces": spaces}
    except Exception:
        pass

    # ── If both failed, try to at least validate the specific NCIP space ──
    try:
        url_single = f"{base_url}/wiki/rest/api/space/NCIP"
        resp3 = _jira_session.get(
            url_single,
            auth=auth,
            headers=headers,
            timeout=(5, 10),
        )
        if resp3.status_code == 200:
            sp_data = resp3.json()
            key = (sp_data.get("key") or "NCIP").strip()
            name = (sp_data.get("name") or "NCIP").strip()
            spaces.append({"key": key, "name": name})
            return {"status": "success", "spaces": spaces}
    except Exception:
        pass

    if not spaces:
        raise HTTPException(
            status_code=404,
            detail=(
                "Could not retrieve Confluence spaces. "
                "Verify that your Jira/Confluence URL, email, and API token are correct, "
                "and that the API token has Confluence read permissions. "
                f"Tried: {base_url}/wiki/rest/api/space"
            ),
        )

    return {"status": "success", "spaces": spaces}


@app.post("/api/debug-confluence-pages")
async def debug_confluence_pages(req: BatchConfluenceLinksRequest):
    """Debug endpoint – diagnose Confluence page linking for NCIP tickets."""
    import logging
    logger = logging.getLogger("debug-confluence")
    settings = req.jiraSettings
    if not settings:
        raise HTTPException(status_code=400, detail="Jira settings required.")

    auth = HTTPBasicAuth(settings.email, settings.apiToken)
    headers = {"Accept": "application/json"}
    base_url = settings.url.rstrip("/")
    spaces_raw = getattr(settings, "confluenceSpaces", None) or ""
    space_keys = [s.strip().upper() for s in spaces_raw.split(",") if s.strip()]

    result: dict[str, Any] = {
        "spaceKeys": space_keys,
        "samplePages": [],
        "titleSearchResults": {},
        "textSearchResults": {},
        "jiraRemoteLinks": {},
        "jiraIssueLinks": {},
        "testKeys": (req.ticketKeys or [])[:5],
    }

    # 1. List recent pages in the configured space
    cql = 'type = "page"'
    if space_keys:
        cql += f' AND space = "{space_keys[0]}"'
    cql += ' ORDER BY lastModified DESC'

    try:
        r = _jira_session.get(
            f"{base_url}/wiki/rest/api/search",
            auth=auth, headers=headers,
            params={"cql": cql, "limit": 20, "excerpt": "none"},
            timeout=(8, 20),
        )
        logger.info(f"Space pages search status={r.status_code}")
        if r.status_code == 200:
            data = r.json()
            for p in data.get("results", []):
                content = p.get("content") or {}
                result["samplePages"].append({
                    "title": content.get("title"),
                    "space": (content.get("space") or {}).get("key"),
                    "webui": (content.get("_links") or {}).get("webui"),
                })
        else:
            result["samplePagesError"] = f"{r.status_code}: {r.text[:300]}"
    except Exception as ex:
        result["samplePagesError"] = str(ex)

    test_keys = result["testKeys"]
    if not test_keys:
        return result

    # 2. CQL title search for ticket keys
    or_clauses = " OR ".join(f'title ~ "{k}"' for k in test_keys)
    cql2 = f'type = "page" AND ({or_clauses})'
    if space_keys:
        cql2 += f' AND space = "{space_keys[0]}"'
    try:
        r2 = _jira_session.get(
            f"{base_url}/wiki/rest/api/search",
            auth=auth, headers=headers,
            params={"cql": cql2, "limit": 20, "excerpt": "none"},
            timeout=(8, 20),
        )
        if r2.status_code == 200:
            for p in r2.json().get("results", []):
                c = p.get("content") or {}
                result["titleSearchResults"][c.get("title", "?")] = (c.get("_links") or {}).get("webui")
        else:
            result["titleSearchResults"]["_error"] = f"{r2.status_code}: {r2.text[:200]}"
    except Exception as ex:
        result["titleSearchResults"]["_error"] = str(ex)

    # 3. CQL text search for ticket keys
    or_clauses_t = " OR ".join(f'text ~ "{k}"' for k in test_keys)
    cql3 = f'type = "page" AND ({or_clauses_t})'
    if space_keys:
        cql3 += f' AND space = "{space_keys[0]}"'
    try:
        r3 = _jira_session.get(
            f"{base_url}/wiki/rest/api/search",
            auth=auth, headers=headers,
            params={"cql": cql3, "limit": 20, "excerpt": "none"},
            timeout=(8, 20),
        )
        if r3.status_code == 200:
            for p in r3.json().get("results", []):
                c = p.get("content") or {}
                result["textSearchResults"][c.get("title", "?")] = (c.get("_links") or {}).get("webui")
        else:
            result["textSearchResults"]["_error"] = f"{r3.status_code}: {r3.text[:200]}"
    except Exception as ex:
        result["textSearchResults"]["_error"] = str(ex)

    # 4. Jira remote links for each test key
    for key in test_keys:
        try:
            rl = _jira_session.get(
                f"{base_url}/rest/api/3/issue/{key}/remotelink",
                auth=auth, headers=headers, timeout=(5, 15),
            )
            if rl.status_code == 200:
                links = rl.json()
                result["jiraRemoteLinks"][key] = [
                    {"title": (l.get("object") or {}).get("title"), "url": (l.get("object") or {}).get("url")}
                    for l in (links if isinstance(links, list) else [])
                ]
            else:
                result["jiraRemoteLinks"][key] = f"HTTP {rl.status_code}"
        except Exception as ex:
            result["jiraRemoteLinks"][key] = str(ex)

    # 5. Jira issue links (issuelinks field)
    for key in test_keys:
        try:
            il = _jira_session.get(
                f"{base_url}/rest/api/3/issue/{key}",
                auth=auth, headers=headers,
                params={"fields": "issuelinks"},
                timeout=(5, 15),
            )
            if il.status_code == 200:
                issue_data = il.json()
                issue_links = (issue_data.get("fields") or {}).get("issuelinks") or []
                result["jiraIssueLinks"][key] = [
                    {
                        "type": (l.get("type") or {}).get("name"),
                        "outwardIssue": (l.get("outwardIssue") or {}).get("key"),
                        "inwardIssue": (l.get("inwardIssue") or {}).get("key"),
                    }
                    for l in issue_links
                ]
            else:
                result["jiraIssueLinks"][key] = f"HTTP {il.status_code}"
        except Exception as ex:
            result["jiraIssueLinks"][key] = str(ex)

    return result


# ── Confluence page links for NCIP tickets ───────────────────────────────────

_CONFLUENCE_LINK_CACHE: dict[str, Any] = {
    "expiresAt": 0.0,
    "value": {},  # ticketKey -> { url, title } | None
}


@app.get("/api/test-confluence")
async def test_confluence(ticketKey: str = Query("NCIP-17285")):
    """Quick debug endpoint: test Confluence search for a single ticket key."""
    # Read Jira settings from the DB-stored tickets (grab base URL from any ticket)
    # We need jiraSettings from the request — but for debugging, read from query or env
    import logging
    logger = logging.getLogger("test-confluence")
    
    base_url = "https://n-able.atlassian.net"
    key = ticketKey.strip().upper()
    
    # Try multiple Confluence search approaches and report results
    results = {"ticketKey": key, "approaches": []}
    
    # We don't have auth here, so just report what URLs we'd call
    cql = f'type = "page" AND title ~ "{key}"'
    results["approaches"].append({
        "name": "CQL title search",
        "url": f"{base_url}/wiki/rest/api/search?cql={cql}&limit=5",
        "note": "Requires auth — use browser/Postman to test"
    })
    results["approaches"].append({
        "name": "CQL content/search",  
        "url": f"{base_url}/wiki/rest/api/content/search?cql={cql}&limit=5",
        "note": "Requires auth — use browser/Postman to test"
    })
    results["approaches"].append({
        "name": "Direct page search",
        "url": f"{base_url}/wiki/rest/api/content?title={key}&spaceKey=NCIP&type=page",
        "note": "Requires auth — use browser/Postman to test"
    })
    results["cache"] = {
        "has_key": key in (_CONFLUENCE_LINK_CACHE.get("value") or {}),
        "cached_value": (_CONFLUENCE_LINK_CACHE.get("value") or {}).get(key),
        "cache_valid": time.time() < float(_CONFLUENCE_LINK_CACHE.get("expiresAt") or 0),
    }
    
    return results


@app.post("/api/batch-confluence-links")
async def batch_confluence_links(req: BatchConfluenceLinksRequest):
    """
    Look up Confluence pages linked to NCIP ticket keys.

    Uses Confluence CQL search (title ~ key OR text ~ key) scoped to configured
    spaces. Returns a map of ticketKey -> { url, title } | null.
    """
    import logging
    logger = logging.getLogger("batch-confluence-links")

    ticket_keys = [k.strip().upper() for k in (req.ticketKeys or []) if k and k.strip()]
    if not ticket_keys:
        return {"status": "success", "links": {}}

    # Cap at 50 keys per request to keep response time reasonable
    ticket_keys = ticket_keys[:50]

    settings = req.jiraSettings
    if not settings:
        try:
            raw = os.environ.get("JIRA_SETTINGS")
            if raw:
                settings = JiraSettings(**json.loads(raw))
        except Exception:
            pass
    if not settings:
        raise HTTPException(status_code=400, detail="Jira settings required to look up Confluence pages.")

    auth = HTTPBasicAuth(settings.email, settings.apiToken)
    headers = {"Accept": "application/json"}
    base_url = settings.url.rstrip("/")

    # Check cache
    now_ts = time.time()
    cached = _CONFLUENCE_LINK_CACHE.get("value") or {}
    cache_valid = now_ts < float(_CONFLUENCE_LINK_CACHE.get("expiresAt") or 0)

    results: dict[str, Any] = {}
    keys_to_lookup: list[str] = []

    for key in ticket_keys:
        if cache_valid and key in cached:
            results[key] = cached[key]
        else:
            keys_to_lookup.append(key)

    if not keys_to_lookup:
        print(f"[Confluence] All {len(ticket_keys)} keys served from cache")
        return {"status": "success", "links": results}

    print(f"[Confluence] Looking up {len(keys_to_lookup)} keys: {keys_to_lookup[:10]}")
    logger.info(f"Looking up Confluence pages for {len(keys_to_lookup)} ticket keys")

    # ── Confluence CQL search — batch by 10 keys per query ────────────────
    batch_size = 10

    # Scope to configured Confluence spaces
    spaces_raw = getattr(settings, "confluenceSpaces", None) or ""
    space_keys = [s.strip().upper() for s in spaces_raw.split(",") if s.strip()]

    def _build_space_cql() -> str:
        if not space_keys:
            return ""
        if len(space_keys) == 1:
            return f' AND space = "{space_keys[0]}"'
        space_list = ",".join(f'"{sk}"' for sk in space_keys)
        return f" AND space IN ({space_list})"

    space_cql = _build_space_cql()

    def _extract_page_info(r: dict) -> tuple:
        """Extract (title, page_url) from a Confluence search result item."""
        # /wiki/rest/api/content/search returns results directly
        # /wiki/rest/api/search wraps in content
        content = r.get("content") or r
        title = content.get("title") or r.get("title") or "Untitled"
        content_links = (content.get("_links") or r.get("_links") or {})
        webui = content_links.get("webui") or ""
        return title, webui

    for i in range(0, len(keys_to_lookup), batch_size):
        batch = keys_to_lookup[i: i + batch_size]

        # Strategy 1: CQL title search via /wiki/rest/api/search
        or_clauses = " OR ".join(f'title ~ "{k}"' for k in batch)
        cql = f'type = "page" AND ({or_clauses}){space_cql}'

        print(f"[Confluence] CQL: {cql}")
        logger.info(f"CQL query: {cql}")

        try:
            # Try the search endpoint
            url1 = f"{base_url}/wiki/rest/api/search"
            print(f"[Confluence] Calling {url1}")
            search_resp = _jira_session.get(
                url1,
                auth=auth,
                headers=headers,
                params={"cql": cql, "limit": len(batch) * 3, "excerpt": "none"},
                timeout=(8, 30),
            )
            print(f"[Confluence] search status: {search_resp.status_code}")
            if search_resp.status_code != 200:
                print(f"[Confluence] search error body: {search_resp.text[:300]}")
            logger.info(f"Confluence search status: {search_resp.status_code}")
            if search_resp.status_code == 200:
                search_data = search_resp.json()
                confluence_base = (
                    (search_data.get("_links") or {}).get("base")
                    or f"{base_url}/wiki"
                )
                results_list = search_data.get("results", []) or []
                print(f"[Confluence] Got {len(results_list)} results")
                for r in results_list:
                    title_dbg = (r.get("content") or r).get("title", "?")
                    print(f"[Confluence]   result: {title_dbg}")
                logger.info(f"Confluence returned {len(results_list)} results")

                for r in results_list:
                    title, webui = _extract_page_info(r)
                    page_url = f"{confluence_base}{webui}" if webui else confluence_base

                    title_upper = title.upper()
                    url_upper = page_url.upper()
                    for key in batch:
                        if key not in results and (key in title_upper or key in url_upper):
                            results[key] = {"url": page_url, "title": title}
                            print(f"[Confluence] ✓ Matched {key} → {title}")
                            logger.info(f"Matched {key} → {title}")
        except Exception as ex:
            print(f"[Confluence] Search exception: {ex}")
            logger.warning(f"Confluence search failed: {ex}")

    # ── Strategy 2: per-key content API search for unmatched keys ─────────
    unmatched = [k for k in keys_to_lookup if k not in results]
    if unmatched:
        print(f"[Confluence] {len(unmatched)} unmatched after CQL, trying /content API per key")
        for key in unmatched[:20]:  # Limit to prevent too many requests
            try:
                # Search using /wiki/rest/api/content with title parameter
                for sp in (space_keys or [""]):
                    params: dict = {"type": "page", "limit": 5}
                    if sp:
                        params["spaceKey"] = sp
                    # Use CQL search with exact title match
                    content_cql = f'title ~ "{key}"'
                    if sp:
                        content_cql += f' AND space = "{sp}"'
                    content_resp = _jira_session.get(
                        f"{base_url}/wiki/rest/api/content/search",
                        auth=auth,
                        headers=headers,
                        params={"cql": content_cql, "limit": 5},
                        timeout=(8, 15),
                    )
                    print(f"[Confluence] content/search for {key} (space={sp}): status={content_resp.status_code}")
                    if content_resp.status_code == 200:
                        content_data = content_resp.json()
                        confluence_base = (
                            (content_data.get("_links") or {}).get("base")
                            or f"{base_url}/wiki"
                        )
                        for r in content_data.get("results", []) or []:
                            title = r.get("title") or "Untitled"
                            webui = (r.get("_links") or {}).get("webui") or ""
                            page_url = f"{confluence_base}{webui}" if webui else confluence_base
                            if key in title.upper() or key in page_url.upper():
                                results[key] = {"url": page_url, "title": title}
                                print(f"[Confluence] ✓ Content-match {key} → {title}")
                                break
                    if key in results:
                        break
            except Exception as ex:
                print(f"[Confluence] Content search exception for {key}: {ex}")

    # ── Strategy 3: text search for remaining unmatched keys ──────────────
    unmatched = [k for k in keys_to_lookup if k not in results]
    if unmatched:
        print(f"[Confluence] {len(unmatched)} still unmatched, trying text search")
        for i in range(0, len(unmatched), batch_size):
            batch = unmatched[i: i + batch_size]
            or_clauses = " OR ".join(f'text ~ "{k}"' for k in batch)
            cql = f'type = "page" AND ({or_clauses}){space_cql}'

            try:
                search_resp = _jira_session.get(
                    f"{base_url}/wiki/rest/api/search",
                    auth=auth,
                    headers=headers,
                    params={"cql": cql, "limit": len(batch) * 2, "excerpt": "none"},
                    timeout=(8, 20),
                )
                print(f"[Confluence] text search status: {search_resp.status_code}")
                if search_resp.status_code == 200:
                    search_data = search_resp.json()
                    confluence_base = (
                        (search_data.get("_links") or {}).get("base")
                        or f"{base_url}/wiki"
                    )
                    for r in search_data.get("results", []) or []:
                        title, webui = _extract_page_info(r)
                        page_url = f"{confluence_base}{webui}" if webui else confluence_base

                        title_upper = title.upper()
                        url_upper = page_url.upper()
                        for key in batch:
                            if key not in results and (key in title_upper or key in url_upper):
                                results[key] = {"url": page_url, "title": title}
                                print(f"[Confluence] ✓ Text-match {key} → {title}")
                                logger.info(f"Text-match {key} → {title}")
            except Exception as ex:
                print(f"[Confluence] Text search exception: {ex}")
                logger.warning(f"Confluence text search failed: {ex}")

    # Mark ticket keys with no Confluence page as null
    for key in keys_to_lookup:
        if key not in results:
            results[key] = None

    matched_count = sum(1 for v in results.values() if v is not None)
    print(f"[Confluence] DONE: {matched_count}/{len(keys_to_lookup)} matched")
    for k, v in results.items():
        if v is not None:
            print(f"[Confluence]   ✓ {k} → {v.get('title','?')} | {v.get('url','?')}")
        else:
            print(f"[Confluence]   ✗ {k} → no page found")
    logger.info(f"Done: {matched_count}/{len(keys_to_lookup)} tickets matched to Confluence pages")

    # Update cache
    merged = {**(cached if cache_valid else {}), **results}
    _CONFLUENCE_LINK_CACHE["value"] = merged
    _CONFLUENCE_LINK_CACHE["expiresAt"] = time.time() + 120.0  # 2 min cache

    return {"status": "success", "links": results}


@app.post("/api/analyze-tickets")
async def analyze_tickets():
    """
    Run automated triage analysis on all tickets without analysis results
    """
    
    try:
        conn = sqlite3.connect('tickets.db')
        cursor = conn.cursor()
        
        # Get ALL tickets and re-analyze them
        cursor.execute('''
            SELECT id, jira_key, summary, description, priority, status
            FROM tickets
        ''')
        
        unanalyzed_tickets = cursor.fetchall()
        
        for ticket in unanalyzed_tickets:
            ticket_id, key, summary, description, priority, status = ticket
            
            # Simple keyword-based component analysis
            component = analyze_component(summary, description)
            
            # Calculate severity score based on priority and keywords
            severity_score = calculate_severity_score(summary, description, priority)
            
            # Determine routing suggestion
            routing_suggestion = determine_routing(component, severity_score, priority)
            
            # Calculate confidence score based on keyword matches
            confidence_score = calculate_confidence(summary, description, component)
            
            # Update ticket with analysis results
            cursor.execute('''
                UPDATE tickets 
                SET component = ?, severity_score = ?, routing_suggestion = ?, confidence_score = ?
                WHERE id = ?
            ''', (component, severity_score, routing_suggestion, confidence_score, ticket_id))
        
        conn.commit()
        conn.close()
        
        return {
            "status": "success",
            "message": f"Analyzed {len(unanalyzed_tickets)} tickets",
            "analyzed_count": len(unanalyzed_tickets)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

def analyze_component(summary: str, description: str) -> str:
    """Analyze ticket content to determine component"""
    text = f"{summary} {description}".lower()
    
    # Component keywords mapping
    components = {
        "Database": ["database", "db", "sql", "connection", "timeout", "query", "table"],
        "Frontend": ["ui", "page", "browser", "css", "javascript", "loading", "display"],
        "Backend": ["api", "server", "endpoint", "service", "internal", "backend"],
        "Mobile App": ["ios", "android", "mobile", "app", "crash", "startup"],
        "Email System": ["email", "notification", "smtp", "mail"],
        "Payment Gateway": ["payment", "transaction", "gateway", "billing", "checkout"],
        "Infrastructure": ["server", "network", "deployment", "infrastructure", "cloud"],
        "Security": ["security", "authentication", "login", "access", "permission"],
        "Integration": ["integration", "third-party", "external", "webhook", "sync"]
    }
    
    # Count keyword matches for each component
    best_match = "General"
    max_matches = 0
    
    for component, keywords in components.items():
        matches = sum(1 for keyword in keywords if keyword in text)
        if matches > max_matches:
            max_matches = matches
            best_match = component
    
    return best_match if max_matches > 0 else "General"

def calculate_severity_score(summary: str, description: str, priority: str) -> float:
    """Calculate severity score from 0.0 to 1.0 based on NCI Severity"""

    # NCI Severity SLO-aligned base scores
    # Blocker: 1-day response+completion (highest)
    # Critical: 1-day response, 3-day completion
    # Major: 3-day response, 5-day completion
    # Moderate: 5-day response, 10-day completion
    priority_scores: dict[str, float] = {
        "blocker":  1.0,
        "critical": 0.85,
        "major":    0.60,
        "moderate": 0.35,
        # Fallback for legacy Jira priority labels
        "high":     0.75,
        "medium":   0.50,
        "low":      0.25,
        "trivial":  0.10,
    }

    base_score = priority_scores.get(priority.lower(), 0.5)

    # Boost for high-impact keywords in summary/description
    text = f"{summary} {description}".lower()
    high_impact_keywords = ["production", "down", "outage", "revenue", "security", "breach", "data loss"]
    medium_impact_keywords = ["error", "failure", "issue", "problem", "stuck", "backup"]

    impact_boost = (
        sum(0.10 for w in high_impact_keywords if w in text) +
        sum(0.04 for w in medium_impact_keywords if w in text)
    )

    return min(1.0, base_score + impact_boost)

def determine_routing(component: str, severity_score: float, priority: str) -> str:
    """Determine which team should handle the ticket based on NCI Severity"""

    p = priority.lower()

    # Blocker or Critical → always Engineering (SLO: 1-day response)
    if p in ("blocker", "critical") or severity_score >= 0.85:
        return "Engineering"

    # Major → Engineering for technical components, Support for user-facing
    technical_components = ["Database", "Backend", "Infrastructure", "Security", "Integration"]
    user_facing = ["Frontend", "Mobile App", "Email System"]

    if p == "major" or severity_score >= 0.60:
        return "Engineering" if component in technical_components else "Support"

    # Moderate / low severity
    if component in user_facing:
        return "Support"

    return "Support" if severity_score < 0.5 else "Engineering"

def calculate_confidence(summary: str, description: str, component: str) -> float:
    """Calculate confidence in the analysis."""
    
    text = f"{summary} {description}".lower()
    
    # Base confidence
    confidence = 0.6
    
    # Boost for detailed descriptions
    if len(description) > 50:
        confidence += 0.1
    
    # Boost for technical keywords
    technical_keywords = ["error", "exception", "failed", "timeout", "crash", "bug"]
    tech_matches = sum(1 for word in technical_keywords if word in text)
    confidence += min(0.2, tech_matches * 0.05)
    
    # Boost if component has strong keyword match
    if component != "General":
        confidence += 0.1
        
    return min(0.98, confidence)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)