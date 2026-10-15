@echo off
echo Starting ClinicOS Patient Medical Document Search - Backend API...
if not exist .venv (
    echo Error: Python virtual environment not found in .venv.
    echo Please run: python -m venv .venv and install requirements.txt
    pause
    exit /b 1
)

.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
