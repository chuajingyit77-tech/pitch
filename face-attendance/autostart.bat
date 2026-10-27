@echo off
chcp 65001 >nul
rem 开机自动启动考勤：在“启动”文件夹里放一个快捷方式
set TARGET=%~dp0start.bat
set LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\人脸考勤.lnk
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%');$s.TargetPath='%TARGET%';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
echo 已设置开机自动启动。如需取消，删除这个文件:
echo   %LINK%
pause
