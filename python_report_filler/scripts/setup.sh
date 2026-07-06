#!/bin/bash
# ============================================================
# 年度检查报告填充 - Linux/macOS 一键安装
# ============================================================
set -e

echo "[setup] 正在安装 Python 依赖..."

cd "$(dirname "$0")/.."

# 检查 Python 是否可用
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] 未找到 Python3，请先安装 Python 3.10+"
    exit 1
fi

# 安装依赖
pip install -r requirements.txt

# 以开发模式安装包
pip install -e .

echo "[setup] 安装完成！使用 'report-filler --help' 查看帮助。"
