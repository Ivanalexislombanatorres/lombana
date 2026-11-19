@echo off
chcp 65001 >nul
title LOMBANA ESTUDIOS - Instalacion
cd /d "%~dp0"
echo ============================================
echo   LOMBANA ESTUDIOS - Instalacion (Windows)
echo ============================================
set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto :found
where python >nul 2>nul
if not errorlevel 1 set "PY=python"
:found
if not defined PY (
  echo [ERROR] No se encontro Python.
  echo Instala Python 3.11 o superior desde https://www.python.org/downloads/
  echo y marca la casilla "Add python.exe to PATH" durante la instalacion.
  pause
  exit /b 1
)
%PY% --version
if not exist ".venv\Scripts\python.exe" (
  echo Creando entorno virtual...
  %PY% -m venv .venv || (echo [ERROR] No se pudo crear el entorno virtual & pause & exit /b 1)
)
echo Instalando dependencias (puede tardar unos minutos la primera vez)...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if errorlevel 1 (echo [ERROR] Fallo la instalacion de dependencias. Revisa tu conexion a internet. & pause & exit /b 1)
if not exist "frontend\dist\index.html" echo [AVISO] Falta frontend\dist. Consulta docs\INSTALACION_WINDOWS.md (seccion desarrolladores).
echo Preparando bases de datos...
".venv\Scripts\python.exe" scripts\admin.py migrar
if errorlevel 1 (echo [ERROR] No se pudieron preparar las bases de datos & pause & exit /b 1)
echo.
echo Instalacion completa. Ahora ejecuta INICIAR.bat
pause
