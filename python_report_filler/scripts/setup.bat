@echo off
REM ============================================================
REM 年度检查报告填充 - Windows 一键安装
REM ============================================================
echo [setup] 正在安装 Python 依赖...

cd /d "%~dp0.."

REM 检查 Python 是否可用
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 未找到 Python，请先安装 Python 3.10+
    exit /b 1
)

REM 安装依赖
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 依赖安装失败
    exit /b 1
)

REM 以开发模式安装包
pip install -e .
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 包安装失败
    exit /b 1
)

echo [setup] 安装完成！使用 "report-filler --help" 查看帮助。
