@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   人脸考勤系统 - 安装（只需运行一次）
echo ==========================================
where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Python。
  echo 请先安装 Python 3.8 以上: https://www.python.org/downloads/
  echo 安装时一定要勾选 "Add Python to PATH"
  pause
  exit /b 1
)
python --version
if not exist venv (
  echo 正在创建虚拟环境...
  python -m venv venv
)
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [错误] 安装依赖失败，请检查网络。国内网络可以试试:
  echo   venv\Scripts\pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  pause
  exit /b 1
)
set PYTHONIOENCODING=utf-8
python download_models.py
if errorlevel 1 ( pause & exit /b 1 )
echo.
echo 安装完成！以后双击 start.bat 启动。
pause
