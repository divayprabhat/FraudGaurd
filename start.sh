#!/usr/bin/env bash
# FraudGuard one-command launcher (macOS/Linux). Serves API + UI on http://localhost:8000
set -e
cd "$(dirname "$0")/backend"
[ -x .venv/bin/python ] || python3 -m venv .venv
source .venv/bin/activate
python -m pip install -q -r requirements.txt
if [ ! -f ../frontend/dist/index.html ]; then
  if command -v npm >/dev/null; then (cd ../frontend && npm install && npm run build)
  else echo "[warn] frontend/dist missing and npm not found - API only, see /docs"; fi
fi
echo; echo "FraudGuard running at http://localhost:8000   (Ctrl+C to stop)"
exec python -m uvicorn app.main:app --port 8000
