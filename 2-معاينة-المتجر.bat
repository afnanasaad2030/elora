@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==================================================
echo   ELORA - معاينة المتجر على هذا الجهاز
echo ==================================================
echo.
python tools\build.py
if errorlevel 1 (
  echo.
  echo [!] حدث خطأ. تاكد ان Python مثبّت على الجهاز.
  echo.
  pause
  exit /b 1
)
echo.
echo --------------------------------------------------
echo   المتصفح سيفتح الان على:  http://localhost:8000
echo   لايقاف المعاينة: اغلق هذه النافذة
echo --------------------------------------------------
echo.
start "" http://localhost:8000
python -m http.server 8000
