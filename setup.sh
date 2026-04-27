#!/bin/bash

# ============================================
#  Incident Tracker — First-Time Setup
#  Run this ONCE after unzipping the project.
# ============================================

set -e

echo ""
echo "=========================================="
echo "  Incident Tracker — Setup"
echo "=========================================="
echo ""

# --- Check prerequisites ---

echo "🔍 Checking prerequisites..."
echo ""

# Check Python
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "❌ Python is not installed."
    echo "   Download it from: https://www.python.org/downloads/"
    echo "   (Windows users: check 'Add Python to PATH' during install)"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1)
echo "   ✅ $PYTHON_VERSION"

# Check pip
if command -v pip3 &> /dev/null; then
    PIP_CMD="pip3"
elif command -v pip &> /dev/null; then
    PIP_CMD="pip"
elif $PYTHON_CMD -m pip --version &> /dev/null; then
    PIP_CMD="$PYTHON_CMD -m pip"
else
    echo "❌ pip is not installed."
    echo "   Try: $PYTHON_CMD -m ensurepip --upgrade"
    exit 1
fi

echo "   ✅ pip found"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "   ✅ Node.js $NODE_VERSION"
else
    echo "❌ Node.js is not installed."
    echo "   Download it from: https://nodejs.org/ (pick LTS)"
    exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "   ✅ npm $NPM_VERSION"
else
    echo "❌ npm is not installed. It should come with Node.js."
    echo "   Reinstall Node.js from: https://nodejs.org/"
    exit 1
fi

echo ""
echo "All prerequisites found!"
echo ""

# --- Get script directory (works even if run from elsewhere) ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Install backend dependencies ---
echo "=========================================="
echo "  Installing backend dependencies..."
echo "=========================================="
echo ""

cd "$SCRIPT_DIR/backend"
$PIP_CMD install -r requirements.txt

echo ""
echo "   ✅ Backend dependencies installed"
echo ""

# --- Install frontend dependencies ---
echo "=========================================="
echo "  Installing frontend dependencies..."
echo "=========================================="
echo ""

cd "$SCRIPT_DIR/frontend"
npm install

echo ""
echo "   ✅ Frontend dependencies installed"
echo ""

# --- Done ---
echo "=========================================="
echo "  ✅ Setup complete!"
echo "=========================================="
echo ""
echo "  To start the app, run:"
echo ""
echo "    ./start.sh"
echo ""
echo "  Then open http://localhost:3000 in your browser."
echo ""
