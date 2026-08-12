@echo off
REM ASCII ONLY - see the note in 3-نشر-على-الإنترنت.bat
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
python tools\preview.py
echo.
pause
