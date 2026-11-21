@echo off
REM FraudGuard one-command launcher (Windows). Creates the venv, installs deps, serves API + UI on http://localhost:8000
cd /d "%~dp0backend"
if not exist .venv\Scripts\python.exe python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -q -r requirements.txt
if not exist "..\frontend\dist\index.html" (
  where npm >nul 2>nul
  if errorlevel 1 (echo [warn] frontend\dist missing and npm not found - API only, see /docs) else (
    pushd ..\frontend
    call npm install
    call npm run build
    popd
  )
)
echo.
echo FraudGuard running at http://localhost:8000   (Ctrl+C to stop)
python -m uvicorn app.main:app --port 8000
