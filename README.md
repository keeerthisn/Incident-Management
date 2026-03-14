# Cove Incident Triage Tool

N-able themed web app for triaging Jira incidents — fetch tickets, group by issue type, filter, and review analytics — all in one place.

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
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── Dashboard.tsx
│   │       ├── TicketList.tsx
│   │       ├── GroupedIssues.tsx
│   │       ├── Analytics.tsx
│   │       ├── Navigation.tsx
│   │       └── Settings.tsx
│   ├── build/             # Pre-built static files (serve these)
│   └── package.json
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
| POST | `/api/debug-fields` | Inspect Jira custom fields |
| GET | `/api/jira-fields` | List all Jira fields |

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
