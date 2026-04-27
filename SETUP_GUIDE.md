# 🚀 Incident Tracker — Quick Setup

> **Time needed:** ~10 minutes  
> **What you need:** A laptop, internet, and a browser. No special software or coding experience required.

---

## ⚡ Quick Start (Easiest Way)

If you're comfortable with a terminal, just run these two commands:

```
# First time only — installs everything:
./setup.sh

# Start the app (run this every time):
./start.sh
```

Then open 👉 **http://localhost:3000** in your browser. That's it!

> **Windows users:** Run `bash setup.sh` and `bash start.sh` in Git Bash or WSL.

If you prefer step-by-step instructions, keep reading below.

---

## ✅ Before You Begin

Install these two free tools (skip if you already have them):

| What to install | Download link | How to check if you have it |
|----------------|---------------|----------------------------|
| **Python** (3.9 or newer) | 👉 https://www.python.org/downloads/ | Open a terminal and type `python3 --version` |
| **Node.js** (16 or newer) | 👉 https://nodejs.org/ (click "LTS") | Open a terminal and type `node --version` |

> ⚠️ **Windows users:** When installing Python, make sure to check the box that says **"Add Python to PATH"** — this is important!

### How to open a terminal
- **Mac:** Press `Cmd + Space`, type **Terminal**, hit Enter
- **Windows:** Press the `Windows key`, type **PowerShell**, hit Enter

---

## 📦 First-Time Setup (do this once)

### 1. Unzip the project

Unzip the `Incident-Tracker.zip` file you received. Remember where you saved it.

### 2. Open a terminal and go to the project folder

**Mac:**
```
cd ~/Desktop/"Incident Tracker"
```

**Windows:**
```
cd C:\Users\YourName\Desktop\"Incident Tracker"
```
*(Replace `YourName` with your actual Windows username)*

### 3. Install the backend

```
cd backend
pip3 install -r requirements.txt
cd ..
```

> 💡 **Windows tip:** If `pip3` doesn't work, use `pip` instead.

### 4. Install the frontend

```
cd frontend
npm install
cd ..
```

✅ **Done!** You won't need to do steps 3–4 again.

---

## ▶️ Running the App

You need **two terminal windows** open at the same time.

### Terminal 1 — Start the backend

```
cd backend
python3 -m uvicorn main:app --reload --port 8000
```

> 💡 **Windows:** Use `python` instead of `python3` if needed.

You'll see this message — that means it's working:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

⚠️ **Keep this window open!**

---

### Terminal 2 — Start the frontend

Open a **new** terminal window:
- **Mac:** Press `Cmd + T` for a new tab, or open a new Terminal window
- **Windows:** Open another PowerShell window

Then run:

```
cd frontend
npx serve -s build
```

> 💡 Remember to navigate to the project folder first if your new terminal doesn't start there.

You'll see:
```
   Serving!
   Local:  http://localhost:3000
```

⚠️ **Keep this window open too!**

---

### Open your browser

Go to:

## 👉 [http://localhost:3000](http://localhost:3000)

The app should load. You're in! 🎉

---

## ⚙️ Connect to Jira

1. Click **Settings** in the left sidebar
2. Fill in these fields:

| Field | What to enter |
|-------|--------------|
| **Jira URL** | Your Atlassian URL, e.g. `https://your-company.atlassian.net` |
| **Email** | Your Atlassian account email |
| **API Token** | Generate one here: 👉 https://id.atlassian.com/manage-profile/security/api-tokens |
| **Project Key** | Your Jira project key, e.g. `NCIP` |
| **JQL** *(optional)* | Custom query to filter tickets |

3. Click **Save Settings**
4. Go to the **Tickets** tab → click **Refresh** to pull your data

---

## 🔄 Next Time You Want to Use the App

No need to reinstall anything. Just open two terminals:

**Terminal 1:**
```
cd "Incident Tracker"/backend
python3 -m uvicorn main:app --reload --port 8000
```

**Terminal 2:**
```
cd "Incident Tracker"/frontend
npx serve -s build
```

Then open 👉 **http://localhost:3000** in your browser.

---

## ⏹️ Stopping the App

Go to each terminal window and press **Ctrl + C** to stop it.

---

## ❓ Something Not Working?

| What went wrong | What to do |
|----------------|-----------|
| `python3` or `python` not found | Reinstall Python from https://www.python.org/downloads/ — on Windows, check "Add to PATH" |
| `pip3` or `pip` not found | Try `python3 -m pip install -r requirements.txt` instead |
| `npm` or `node` not found | Reinstall Node.js from https://nodejs.org/ |
| "Port 8000 already in use" | **Mac:** Run `lsof -ti tcp:8000 \| xargs kill -9` <br> **Windows:** Close other terminals or restart your computer |
| "Port 3000 already in use" | Same as above, but for port 3000 |
| Browser shows a blank page | Make sure **both** terminal windows are still running |
| Jira says "401 Unauthorized" | Your API token may have expired — generate a new one |
| Jira returns no tickets | Double-check your JQL query in Jira's own search first |

> **Still stuck?** Reach out to the team on Slack/Teams and share a screenshot of the error in your terminal.

---

*© 2026 N-able. All rights reserved.*
