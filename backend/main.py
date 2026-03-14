from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import os
import json
import sqlite3
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from requests.auth import HTTPBasicAuth
from datetime import datetime, timedelta
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

class JiraSettings(BaseModel):
    url: str
    email: str
    apiToken: str
    projectKey: str
    daysBack: int = 30
    quickFilterId: Optional[int] = None
    jql: Optional[str] = None   # custom JQL from Settings UI; overrides default filter

class FetchTicketsRequest(BaseModel):
    jiraSettings: Optional[JiraSettings] = None

class TicketData(BaseModel):
    key: str
    summary: str
    status: str
    priority: str
    created: str
    assignee: str
    description: str

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
            timeout=(5, 10),
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
        raise HTTPException(status_code=504, detail="Connection timed out after 5s — check the Jira URL")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/fetch-tickets")
async def fetch_tickets_from_jira(body: Optional[FetchTicketsRequest] = None):
    """
    Fetch tickets from Jira if credentials are provided,
    otherwise return sample data for demo purposes.
    """
    
    # If Jira credentials provided, call real Jira API
    if body and body.jiraSettings:
        return await _fetch_from_real_jira(body.jiraSettings)
    
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


async def _fetch_from_real_jira(settings: JiraSettings):
    """Internal helper: call real Jira API with provided credentials."""
    try:
        # Use the newer Jira search API path; the old /rest/api/3/search
        # returns HTTP 410 and instructs to migrate to /rest/api/3/search/jql.
        jira_url = f"{settings.url.rstrip('/')}/rest/api/3/search/jql"
        # If a custom JQL is provided, use it directly so callers can
        # match a specific board + quick filter configuration.
        if getattr(settings, 'jql', None):
            jql = settings.jql  # type: ignore[assignment]
        else:
            days_back = getattr(settings, 'daysBack', 30)
            # Default JQL for NCIP project - open/in-progress issues updated recently
            jql = (
                f'project = {settings.projectKey} '
                f'AND updated >= -{days_back}d '
                f'AND statusCategory != Done '
                f'ORDER BY updated DESC'
            )
        
        # Jira API request basics
        auth = HTTPBasicAuth(settings.email, settings.apiToken)
        headers = {
            "Accept": "application/json"
        }

        # ── Step 1: Discover NCI Severity field ID from Jira's field catalogue ──
        nci_severity_field_id: Optional[str] = None
        try:
            field_resp = requests.get(
                f"{settings.url.rstrip('/')}/rest/api/3/field",
                auth=auth,
                headers=headers,
                timeout=(10, 30),
                verify=False,
            )
            if field_resp.status_code == 200:
                all_fields = field_resp.json()
                for f in all_fields:
                    fname = (f.get("name") or "").lower()
                    if "nci severity" in fname or fname == "severity":
                        nci_severity_field_id = f.get("id")
                        print(f"[fields] found NCI Severity field: id={nci_severity_field_id} name={f.get('name')!r}")
                        break
                if not nci_severity_field_id:
                    # Log all custom field names to help diagnose
                    custom_names = [(f.get("id"), f.get("name")) for f in all_fields if f.get("id","").startswith("customfield")]
                    print(f"[fields] NCI Severity not found. Custom fields: {custom_names[:30]}")
        except Exception as fe:
            print(f"[fields] field discovery failed: {fe}")

        # ── Step 2: Fetch all pages of tickets ──
        # Jira Cloud /search/jql supports BOTH cursor pagination (nextPageToken)
        # AND offset pagination (startAt / total).  We handle all combinations:
        #   - If response contains nextPageToken  → cursor mode (preferred)
        #   - If response contains isLast == True → stop
        #   - Otherwise fall back to startAt + total
        all_issues: list[dict[str, Any]] = []
        page_size = 100   # Jira Cloud hard cap per request
        start_at = 0
        # Explicitly name required fields — /search/jql ignores *all* for custom fields
        base_fields = ["summary", "status", "priority", "assignee", "created",
                       "components", "description", "labels"]
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
                "startAt": start_at,
            }
            if next_page_token:
                params["nextPageToken"] = next_page_token

            print(f"[fetch] page={page_num} startAt={start_at} token={str(next_page_token)[:60] if next_page_token else 'none'}")

            response = requests.get(
                jira_url,
                auth=auth,
                headers=headers,
                params=params,
                timeout=(10, 60),
                verify=False,
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

            print(f"[fetch] got={len(issues)} total={total_reported} isLast={is_last} hasToken={bool(next_page_token)} accumulated={len(all_issues)+len(issues)}")

            if not issues:
                print("[fetch] empty page — done")
                break

            # Log ALL non-null custom fields from the very first issue so we
            # can identify the correct NCI Severity field ID.
            if page_num == 1 and issues:
                first_fields = issues[0].get("fields", {})
                nonnull_custom = {
                    k: v for k, v in first_fields.items()
                    if v not in (None, [], {}, "") and k.startswith("customfield")
                }
                print(f"[debug] first issue {issues[0]['key']} non-null customfields: {nonnull_custom}")
                print(f"[debug] priority field = {first_fields.get('priority')!r}")
                # Write to file for easy terminal inspection
                import json as _json
                with open("/tmp/jira_fields.json", "w") as _f:
                    _json.dump({"key": issues[0]["key"], "priority": first_fields.get("priority"), "customfields": nonnull_custom}, _f, indent=2)

            all_issues.extend(issues)
            start_at += len(issues)

            # Stop conditions (checked in priority order)
            if is_last is True:
                print("[fetch] isLast=True — done")
                break
            if next_page_token:
                # Cursor mode: keep looping; token already set for next params
                continue
            # Offset mode: stop when we've retrieved everything reported
            if total_reported and start_at >= total_reported:
                print(f"[fetch] offset done ({start_at}>={total_reported})")
                break

        # Process and store tickets
        tickets = []
        conn = sqlite3.connect('tickets.db')
        cursor = conn.cursor()

        # Clean up any demo/sample tickets that may have been
        # inserted earlier (keys like INC-001, INC-002, ...).
        cursor.execute("DELETE FROM tickets WHERE jira_key LIKE 'INC-%'")

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
            }
            
            tickets.append(ticket)
            
            # Store in database
            cursor.execute('''
                INSERT OR REPLACE INTO tickets 
                (jira_key, summary, status, priority, created_date, assignee, description, jira_components, product_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                ticket["key"],
                ticket["summary"],
                ticket["status"], 
                ticket["priority"],
                ticket["created"],
                ticket["assignee"],
                ticket["description"],
                ticket["jira_components"],
                ticket["product_name"],
            ))
        
        conn.commit()
        conn.close()
        
        return {
            "status": "success",
            "message": f"Successfully fetched {len(tickets)} tickets from Jira",
            "count": len(tickets),
            "tickets": tickets,
        }
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Failed to connect to Jira: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch tickets: {str(e)}")

@app.get("/api/tickets")
async def get_stored_tickets():
    """Get all stored tickets from database"""
    try:
        conn = sqlite3.connect('tickets.db')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT jira_key, summary, status, priority, created_date, assignee, description,
                   jira_components, product_name,
                   component, severity_score, routing_suggestion, confidence_score
            FROM tickets 
            ORDER BY created_date DESC
        ''')
        
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
                "confidence_score": row[12]
            })
        
        return {
            "status": "success",
            "count": len(tickets),
            "tickets": tickets
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get tickets: {str(e)}")

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