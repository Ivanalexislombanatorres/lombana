@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (echo Ejecuta primero INSTALAR.bat & pause & exit /b 1)
set "PORT=8000"
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /b "LOMBANA_PORT=" .env') do set "PORT=%%b"
echo Iniciando LOMBANA ESTUDIOS en http://127.0.0.1:%PORT%
echo No cierres esta ventana mientras uses el sistema. Para apagar: DETENER.bat o Ctrl+C.
start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:%PORT%"
title LOMBANA ESTUDIOS - servidor
cd backend
"..\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port %PORT%
pause
