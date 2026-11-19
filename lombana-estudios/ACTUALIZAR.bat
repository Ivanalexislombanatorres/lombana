@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (echo Ejecuta primero INSTALAR.bat & pause & exit /b 1)
echo 1/3 Respaldo previo obligatorio...
".venv\Scripts\python.exe" scripts\admin.py respaldar || (echo [ERROR] Respaldo fallido: no se actualiza & pause & exit /b 1)
echo 2/3 Actualizando dependencias...
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
echo 3/3 Aplicando migraciones (no borran datos)...
".venv\Scripts\python.exe" scripts\admin.py migrar
pause
