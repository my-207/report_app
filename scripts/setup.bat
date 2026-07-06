@echo off
echo ==========================================
echo   年度检查报告自动填充 - 环境安装脚本
echo ==========================================
echo.

cd /d "%~dp0..\server"

echo [1/2] 安装 Node.js 依赖...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install 失败，请检查网络连接
    pause
    exit /b 1
)

echo [2/2] 编译 TypeScript...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] TypeScript 编译失败
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   安装完成！
echo   启动开发服务器: cd server ^&^& npm run dev
echo   启动生产服务器: cd server ^&^& npm start
echo ==========================================
pause
