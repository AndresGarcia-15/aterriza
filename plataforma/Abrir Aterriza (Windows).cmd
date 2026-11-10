@echo off
rem Doble clic para abrir Aterriza en Windows
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1" %*
pause
