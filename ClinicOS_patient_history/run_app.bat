@echo off
echo ========================================================
echo  ClinicOS | Patient Medical Document Search System
echo ========================================================
echo.
echo 1. Launching Backend API server on http://127.0.0.1:8000
start "ClinicOS Backend" cmd /k ".\run_backend.bat"

echo 2. Launching Frontend UI on http://localhost:5173
start "ClinicOS Frontend" cmd /k ".\run_frontend.bat"

echo.
echo Application started!
echo Frontend: http://localhost:5173
echo Backend API Docs: http://127.0.0.1:8000/docs
echo.
