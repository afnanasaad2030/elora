@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==================================================
echo   ELORA - نشر التحديث على الانترنت
echo ==================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [!] Git غير مثبّت. حمّله من:  https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo [!] لم يتم ربط المتجر بحساب GitHub بعد.
  echo     راجع القسم 5 في ملف: دليل-ELORA.md
  echo.
  pause
  exit /b 1
)

echo [1/3] تحديث قائمة المنتجات...
python tools\build.py
if errorlevel 1 ( echo [!] فشل التحديث. & pause & exit /b 1 )

echo.
echo [2/3] تجهيز الملفات...
git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo     لا توجد تغييرات جديدة. المتجر محدّث اصلا.
  echo.
  pause
  exit /b 0
)
git commit -m "تحديث المعرض"

echo.
echo [3/3] الرفع...
git push
if errorlevel 1 (
  echo.
  echo [!] فشل الرفع. تحقق من الاتصال بالانترنت او من بيانات دخول GitHub.
  echo.
  pause
  exit /b 1
)

echo.
echo ==================================================
echo   تم النشر بنجاح.
echo   سيظهر التحديث على الموقع خلال دقيقة تقريبا.
echo ==================================================
echo.
pause
