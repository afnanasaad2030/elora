@echo off
REM ASCII ONLY - do not add Arabic text to this file.
REM cmd.exe mis-parses .bat files that mix non-ASCII bytes with chcp 65001,
REM which silently chops the first characters off commands (else -> se).
REM All Arabic output lives in tools\publish.py instead.
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
python tools\publish.py
echo.
pause
