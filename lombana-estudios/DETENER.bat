@echo off
chcp 65001 >nul
taskkill /FI "WINDOWTITLE eq LOMBANA ESTUDIOS - servidor*" /T /F >nul 2>nul
if errorlevel 1 (echo No habia un servidor en ejecucion.) else (echo Servidor detenido.)
timeout /t 3 >nul
