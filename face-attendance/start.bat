@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
title 人脸考勤系统 - 不要关闭这个窗口
call venv\Scripts\activate.bat
rem 第一次启动时自动全屏打开签到屏（按 Alt+F4 可关闭全屏浏览器）
python app.py --open-kiosk
:loop
echo 程序意外退出，5 秒后自动重启...
timeout /t 5 >nul
python app.py
goto loop
