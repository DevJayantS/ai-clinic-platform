@echo off
echo Seeding synthetic demonstration patients and medical documents...
.\.venv\Scripts\python.exe backend/seed_demo_data.py
pause
