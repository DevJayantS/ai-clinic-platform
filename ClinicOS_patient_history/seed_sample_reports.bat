@echo off
echo ========================================================
echo  Generating & Seeding 14 Synthetic Medical Reports
echo ========================================================
.\.venv\Scripts\python.exe backend/generate_and_seed_test_reports.py
pause
