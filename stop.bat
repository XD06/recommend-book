@echo off
chcp 65001 >nul
echo ==========================================
echo      DeepRead 项目一键关闭脚本
echo ==========================================
echo.

echo [1/2] 正在关闭后端服务 (Node.js 端口 3001)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
    echo       找到进程 PID: %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo [2/2] 正在关闭前端服务 (Node.js 端口 5173)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173') do (
    echo       找到进程 PID: %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo ==========================================
echo  所有服务已关闭！
echo ==========================================
echo.
pause
