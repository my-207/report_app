#!/bin/bash
# ============================================================
# Skill 入口: 填充报告
# 用法: fill.sh --template template.docx --data data.json --output output.docx
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# 解析参数
TEMPLATE=""
DATA=""
OUTPUT="output.docx"

while [[ $# -gt 0 ]]; do
    case $1 in
        --template) TEMPLATE="$2"; shift 2 ;;
        --data)     DATA="$2"; shift 2 ;;
        --output)   OUTPUT="$2"; shift 2 ;;
        -t)         TEMPLATE="$2"; shift 2 ;;
        -d)         DATA="$2"; shift 2 ;;
        -o)         OUTPUT="$2"; shift 2 ;;
        *)          echo "未知参数: $1"; exit 1 ;;
    esac
done

if [ -z "$TEMPLATE" ] || [ -z "$DATA" ]; then
    echo "用法: $0 --template <template.docx> --data <data.json|data.yaml> [--output output.docx]"
    exit 1
fi

python -m report_filler.cli fill --template "$TEMPLATE" --data "$DATA" --output "$OUTPUT"
