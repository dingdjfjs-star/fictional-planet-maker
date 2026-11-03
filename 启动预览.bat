@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   虚构行星工坊 - Cesium 三维预览
echo   http://127.0.0.1:8961
echo ============================================
start "" "http://127.0.0.1:8961"
node server.js
pause
