@echo off
chcp 65001 >nul
title 剪贴面板
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo [错误] 尚未安装 Electron，请先运行 install.bat
  pause
  exit /b 1
)

rem 每次启动清空旧的诊断日志，便于排查本次运行的问题
if exist debug.log del /q debug.log >nul 2>nul

rem 直接启动 Electron 可执行文件，无控制台窗口
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
