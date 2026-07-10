@echo off
chcp 65001 >nul
echo ==========================================
echo      DeepRead 项目一键启动脚本
echo ==========================================
echo.

REM 设置窗口标题
title DeepRead 开发服务器

REM 获取当前目录
set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

echo [1/3] 正在启动后端服务...
echo       路径: %PROJECT_ROOT%backend
start "DeepRead Backend" cmd /k "cd /d "%PROJECT_ROOT%backend" && npm run dev"

REM 等待后端启动
timeout /t 3 /nobreak >nul

echo [2/3] 正在启动前端服务...
echo       路径: %PROJECT_ROOT%
start "DeepRead Frontend" cmd /k "cd /d "%PROJECT_ROOT%" && npm run dev"

echo [3/3] 服务启动完成！
echo.
echo ==========================================
echo  后端 API: http://localhost:3001
echo  前端页面: http://localhost:5173
echo ==========================================
echo.
echo 提示: 关闭窗口或运行 stop.bat 停止服务
echo.
pause
