@echo off
chcp 65001 >nul
title 安装剪贴面板依赖
cd /d "%~dp0"

echo 正在安装 Electron（使用国内镜像，首次约需下载 100MB）...
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "electron_config_cache=%~dp0.electron-cache"

call npm install --save-dev electron --cache "%~dp0.npm-cache" --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [错误] npm install 失败，请检查网络后重试。
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo 正在下载 Electron 二进制文件...
  call node node_modules\electron\install.js
)

if exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo 安装完成！双击「启动剪贴面板.bat」即可使用。
) else (
  echo.
  echo [错误] Electron 二进制下载失败，请检查网络后重试。
)
pause
