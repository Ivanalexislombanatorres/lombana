@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (echo Ejecuta primero INSTALAR.bat & pause & exit /b 1)
echo Respaldando la fabrica y todos los ERP en la carpeta backups...
".venv\Scripts\python.exe" scripts\admin.py respaldar
pause
