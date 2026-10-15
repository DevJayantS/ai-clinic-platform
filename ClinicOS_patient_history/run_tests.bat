@echo off
echo Running ClinicOS Automated Test Suite...
.\.venv\Scripts\python.exe -m pytest backend/tests -v
pause
