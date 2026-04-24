# Cove Incident Management Tool

N-able themed web app for managing Jira incidents — fetch tickets, group by issue type, filter, and review analytics — all in one place.

---

## 🎯 Overview

The **Cove Incident Management Tool** is a comprehensive incident triage and analysis platform that integrates with Jira and Salesforce to help support teams:

- **Quickly triage** incoming incidents with AI-powered routing suggestions
- **Identify patterns** across similar issues affecting multiple customers
- **Detect duplicates** by cross-referencing Salesforce case numbers
- **Analyze root causes** with Confluence knowledge base integration
- **Track escalations** and prioritize high-impact incidents

---

## ✨ Key Features

### 📊 Dashboard
Real-time overview of ticket metrics, priority distribution, and recent activity.

### 🎫 Tickets
- Browse all Jira tickets with advanced filtering (status, priority, product, component)
- View escalation status from Jira custom fields
- Click-through links to original Jira issues
- Analyze individual tickets with AI routing suggestions

### 📁 Grouped Issues
Tickets automatically grouped by issue type/component for pattern recognition.

### 📈 Analytics
- Monthly ticket creation trends
- Priority and status breakdowns
- Product-wise distribution charts
- Filtered views based on date range (daysBack setting)

### 🧠 Root Cause Analyzer
- AI-powered analysis of ticket descriptions
- Confluence knowledge base search for related documentation
- Suggested investigation steps and action items

### 🔧 Resolution Assistant
- Find similar resolved tickets to guide troubleshooting
- Cross-reference historical resolutions
- Confidence scoring for suggested solutions

### ⚙️ Settings
- Jira connection configuration (URL, API token, project key, JQL)
- Salesforce integration (OAuth2 or username/password authentication)
- Confluence space selection for knowledge base scope
- Customizable date range (daysBack filter)

---

## 🔐 Integrations

| Platform | Purpose | Auth Method |
|----------|---------|-------------|
| **Jira** | Fetch incidents, custom fields (escalation, severity) | API Token |
| **Confluence** | Knowledge base search for root cause analysis | API Token (same as Jira) |
| **Salesforce** | Case details, duplicate detection | OAuth2 (Connected App) or Password |

---

## Prerequisites

Make sure the following are installed on the machine:

| Tool | Minimum version | Check |
|------|----------------|-------|
| Python | 3.9+ | `python3 --version` |
| Node.js | 16+ | `node --version` |
| npm | 8+ | `npm --version` |

---

## 1 — Clone / copy the project

```bash
# If using git
git clone <repo-url> "Incident Tracket"
cd "Incident Tracket"

# Or just unzip/copy the folder and cd into it
cd "Incident Tracket"
```

---

## 2 — Install backend dependencies

```bash
cd backend
pip3 install -r requirements.txt
cd ..
```

> **Tip (optional):** use a virtual environment to keep packages isolated:
> ```bash
> python3 -m venv .venv
> source .venv/bin/activate   # macOS / Linux
> .venv\Scripts\activate      # Windows
> pip install -r backend/requirements.txt
> ```

---

## 3 — Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

---

## 4 — Run the backend

Open **Terminal 1** and run:

```bash
cd backend
python3 -m uvicorn main:app --reload --port 8000
```

You should see:
```
INFO: Uvicorn running on http://127.0.0.1:8000
```

---

## 5 — Serve the frontend

The frontend is pre-built. Open **Terminal 2** and run:

```bash
cd frontend
npx serve -s build
```

The app will be available at **http://localhost:3000**

> **For development** (with hot reload), run `npm start` instead — this starts on port 3000 automatically.

---

## 6 — Open the app

Visit **http://localhost:3000** in your browser.

---

## 7 — Configure Jira connection

1. Click **Settings** in the left sidebar
2. Fill in:
   - **Jira URL** — e.g. `https://your-company.atlassian.net`
   - **Email** — your Atlassian account email
   - **API Token** — generate one at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   - **Project Key** — e.g. `NCIP`
   - **JQL** (optional) — custom query, e.g. `project = NCIP AND component = "Cove - M365" AND created >= -180d ORDER BY created DESC`
3. Click **Save Settings**

---

## 8 — Fetch tickets

1. Go to the **Tickets** tab
2. Click **Refresh** — this pulls tickets from Jira using your saved settings
3. All tickets are stored locally in `backend/tickets.db` (SQLite)

---

## Project structure

```
Incident Tracket/
├── backend/
│   ├── main.py            # FastAPI app — all API endpoints
│   ├── requirements.txt   # Python dependencies
│   └── tickets.db         # SQLite database (auto-created on first run)
├── frontend/
│   ├── src/
│   │   ├── App.tsx        # Main app with routing
│   │   ├── config.ts      # API base URL configuration
│   │   └── components/
│   │       ├── Dashboard.tsx         # Overview metrics
│   │       ├── TicketList.tsx        # Ticket table with filters
│   │       ├── GroupedIssues.tsx     # Grouped by issue type
│   │       ├── Analytics.tsx         # Charts and trends
│   │       ├── RootCauseAnalyzer.tsx # AI root cause analysis
│   │       ├── ResolutionAssistant.tsx # Find similar resolved tickets
│   │       ├── Navigation.tsx        # Sidebar menu
│   │       ├── Settings.tsx          # Jira & Salesforce config
│   │       └── Login.tsx             # Login screen
│   ├── build/             # Pre-built static files (serve these)
│   └── package.json
├── docker-compose.yml     # Optional Docker deployment
├── render.yaml            # Render.com deployment config
└── README.md
```

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/fetch-tickets` | Fetch tickets from Jira |
| GET | `/api/tickets` | Get all stored tickets |
| POST | `/api/analyze-tickets` | Run triage analysis |
| POST | `/api/test-connection` | Test Jira connection |
| POST | `/api/sf-test-connection` | Test Salesforce connection |
| POST | `/api/sf-cases` | Fetch SF case details |
| POST | `/api/root-cause-analyze` | Analyze root cause with AI |
| POST | `/api/resolution-assistant` | Find similar resolved tickets |
| POST | `/api/confluence-spaces` | List Confluence spaces |

Interactive API docs: **http://localhost:8000/docs**

---

## Troubleshooting

**Port 8000 already in use**
```bash
lsof -ti tcp:8000 | xargs kill -9
```

**Frontend not loading after `npx serve -s build`**
Make sure you ran `npm install` in the `frontend/` directory first. If the `build/` folder is missing, run `npm run build` inside `frontend/`.

**Jira returns 401 Unauthorized**
Re-check your API token — tokens expire or can be revoked. Generate a new one at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).

**Jira returns 0 tickets**
Check your JQL in Settings. Test it directly in Jira's issue search first.

---

Step-by-step setup:

Prerequisites check (Python 3.9+, Node 16+, npm 8+)
Install Python deps (pip3 install -r backend/requirements.txt)
Install frontend deps (cd frontend && npm install)
Run backend: python3 -m uvicorn main:app --reload --port 8000
Serve frontend: npx serve -s build → opens on localhost:3000
Configure Jira in Settings (URL, email, API token, JQL)
Click Refresh in the Tickets tab to pull data

-------


## © 2026 N-able. All rights reserved.
