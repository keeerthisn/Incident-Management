#!/bin/bash

# ============================================
#  Incident Tracker — Start App
#  Launches both backend and frontend servers.
#  Press Ctrl+C to stop everything.
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Detect Python command ---
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "❌ Python not found. Run ./setup.sh first."
    exit 1
fi

# --- Check if dependencies are installed ---
if [ ! -d "$SCRIPT_DIR/frontend/node_modules" ]; then
    echo "❌ Dependencies not installed. Run ./setup.sh first."
    exit 1
fi

echo ""
echo "=========================================="
echo "  Incident Tracker — Starting..."
echo "=========================================="
echo ""

# --- Cleanup function to stop both servers on Ctrl+C ---
cleanup() {
    echo ""
    echo ""
    echo "⏹️  Stopping servers..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo "   Servers stopped. Goodbye!"
    echo ""
    exit 0
}

trap cleanup SIGINT SIGTERM

# --- Start backend ---
echo "▶️  Starting backend on http://localhost:8000 ..."
cd "$SCRIPT_DIR/backend"
$PYTHON_CMD -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# --- Start frontend ---
echo "▶️  Starting frontend on http://localhost:3000 ..."
cd "$SCRIPT_DIR/frontend"
npx serve -s build -l 3000 &
FRONTEND_PID=$!

# Give frontend a moment to start
sleep 2

echo ""
echo "=========================================="
echo "  ✅ App is running!"
echo "=========================================="
echo ""
echo "  👉 Open http://localhost:3000 in your browser"
echo ""
echo "  Press Ctrl+C to stop both servers."
echo ""

# --- Wait for both processes ---
wait $BACKEND_PID $FRONTEND_PID
