#!/bin/bash
# ============================================================
# Skill 入口: 分析模板
# 用法: analyze.sh --template template.docx
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

TEMPLATE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --template) TEMPLATE="$2"; shift 2 ;;
        -t)         TEMPLATE="$2"; shift 2 ;;
        *)          echo "未知参数: $1"; exit 1 ;;
    esac
done

if [ -z "$TEMPLATE" ]; then
    echo "用法: $0 --template <template.docx>"
    exit 1
fi

python -m report_filler.cli analyze --template "$TEMPLATE"
