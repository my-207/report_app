"""
分析模板 .docx 文件，精确找出所有需要补充的内容。

用法:
    python analyze_template.py <模板文件路径> [--output result.json]
    
示例:
    python analyze_template.py "../年度检查报告（模版）.docx"
"""

import argparse
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from collections import defaultdict
from typing import List, Dict, Tuple, Optional

# ─── Word 命名空间 ───
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
}


def register_namespaces():
    """注册所有命名空间以便 XPath 查询"""
    for prefix, uri in NS.items():
        ET.register_namespace(prefix, uri)


def read_docx_xml(docx_path: str) -> Tuple[str, str]:
    """读取 docx 中的 document.xml 内容"""
    with zipfile.ZipFile(docx_path, "r") as zf:
        xml_bytes = zf.read("word/document.xml")
        xml_str = xml_bytes.decode("utf-8")
    return xml_str, str(Path(docx_path).name)


# ─── 分析 1: 占位符检测 ───

def analyze_placeholders(xml_str: str) -> Dict:
    """
    检测文档中所有可能的占位符模式。
    占位符特征：
    - 连续的 X 字符（如 XXXXX、XXXXXX）
    - X-分隔的报告编号格式（XXXXX-XXXX-XXXX-202X）
    - 20XX 年份占位符（202X）
    - X 字符开头的中文公司名占位符（XXXXXXX公司）
    """
    results = {
        "report_number_placeholders": [],
        "x_pattern_placeholders": [],
        "date_placeholders": [],
        "other_placeholders": [],
    }

    # 提取所有文本运行
    texts = extract_all_texts(xml_str)

    # 1. 报告编号占位符: 含 X 和 - 的模式
    report_pattern = re.compile(r"[A-Z]*X{2,5}-X{2,4}-X{2,4}-20\dX")
    for text in texts:
        for m in report_pattern.finditer(text):
            results["report_number_placeholders"].append({
                "text": m.group(),
                "context": text,
                "type": "报告编号占位符",
            })

    # 2. 连续 X 占位符（3个以上）
    x_pattern = re.compile(r"X{3,}")
    for text in texts:
        for m in x_pattern.finditer(text):
            x_text = m.group()
            # 跳过已经匹配的报告编号
            if "-" in text:
                continue
            results["x_pattern_placeholders"].append({
                "text": x_text,
                "context": text,
                "len": len(x_text),
                "type": guess_placeholder_type(text, x_text),
            })

    # 3. 日期占位符: 202X年X月XX日 或 202X年X月
    date_pattern = re.compile(r"20\dX年\d?X月\d?X?日?|20\dX年\d?X月")
    for text in texts:
        for m in date_pattern.finditer(text):
            results["date_placeholders"].append({
                "text": m.group(),
                "context": text,
                "type": "日期占位符",
            })

    return results


def guess_placeholder_type(context: str, match: str) -> str:
    """根据上下文猜测占位符类型"""
    if "公司" in context:
        return "单位名称占位符"
    if "管线" in context or "管道" in context or "设备" in context:
        return "设备/管线名称占位符"
    if "编号" in context or "报告" in context:
        return "报告编号占位符"
    if "名称" in context:
        return "名称占位符"
    return "未知占位符"


# ─── 分析 2: 表格结构检测 ───

def analyze_tables(xml_str: str) -> List[Dict]:
    """解析文档中所有表格的结构"""
    root = ET.fromstring(xml_str)
    tables = []

    for tbl_idx, tbl_elem in enumerate(root.iter(f"{{{NS['w']}}}tbl")):
        tbl_info = {
            "table_index": tbl_idx + 1,
            "rows": [],
        }

        # 解析每一行
        for row_idx, row_elem in enumerate(tbl_elem.iter(f"{{{NS['w']}}}tr")):
            cells = []
            for cell_elem in row_elem.iter(f"{{{NS['w']}}}tc"):
                cell_text = "".join(
                    t.text or ""
                    for t in cell_elem.iter(f"{{{NS['w']}}}t")
                )
                cells.append(cell_text)
            tbl_info["rows"].append({
                "row_index": row_idx + 1,
                "cells": cells,
                "is_empty": all(c == "" for c in cells),
            })

        # 判断表头和行数
        if tbl_info["rows"]:
            tbl_info["header_row"] = tbl_info["rows"][0]["cells"] if len(tbl_info["rows"]) > 0 else []
            tbl_info["total_rows"] = len(tbl_info["rows"])
            tbl_info["data_rows"] = sum(1 for r in tbl_info["rows"] if not r["is_empty"])
            tbl_info["empty_rows"] = sum(1 for r in tbl_info["rows"] if r["is_empty"])
            tbl_info["table_title"] = infer_table_title(tbl_info["header_row"])

        tables.append(tbl_info)

    return tables


def infer_table_title(header_cells: List[str]) -> str:
    """根据表头推断表格类型"""
    header_text = " ".join(header_cells)
    if "检验" in header_text or "检测" in header_text:
        return "检验/检测结果表"
    if "检查" in header_text:
        return "检查结果表"
    if "参数" in header_text:
        return "参数表"
    if "序号" in header_text or "编号" in header_text:
        return "数据表"
    return "通用表格"


# ─── 分析 3: 文本结构检测 ───

def analyze_text_structure(xml_str: str) -> Dict:
    """分析文档的文本结构：段落、标题、签名行"""
    root = ET.fromstring(xml_str)
    paragraphs = []
    headings = []

    for p_elem in root.iter(f"{{{NS['w']}}}p"):
        # 提取段落文本
        para_text = "".join(
            t.text or ""
            for t in p_elem.iter(f"{{{NS['w']}}}t")
        )

        if not para_text.strip():
            continue

        # 检查段落样式（判断是否为标题）
        p_style = None
        for pPr in p_elem.iter(f"{{{NS['w']}}}pPr"):
            for pStyle in pPr.iter(f"{{{NS['w']}}}pStyle"):
                p_style = pStyle.get(f"{{{NS['w']}}}val")
                break

        para_info = {
            "text": para_text,
            "style": p_style,
            "is_heading": p_style and "Heading" in str(p_style) if p_style else False,
            "has_x_placeholder": bool(re.search(r"X{2,}", para_text)),
            "has_date_placeholder": bool(re.search(r"20\dX", para_text)),
        }

        if para_info["is_heading"]:
            headings.append(para_info)
        else:
            paragraphs.append(para_info)

    return {
        "total_paragraphs": len(paragraphs) + len(headings),
        "headings": headings,
        "content_paragraphs": paragraphs,
    }


# ─── 分析 4: 需要补充的内容汇总 ───

def generate_fill_requirements(
    placeholder_analysis: Dict,
    table_analysis: List[Dict],
    text_analysis: Dict,
) -> Dict:
    """汇总模板中需要补充的所有内容"""

    requirements = {
        "basic_info_fields": [],
        "signature_dates": [],
        "tables_to_fill": [],
        "summary": {},
    }

    # 基础信息字段
    field_map = {
        "报告编号占位符": "reportNumber",
        "单位名称占位符": "companyName",
        "设备/管线名称占位符": "deviceName",
        "名称占位符": "deviceName",
        "未知占位符": "unknown",
    }

    seen_fields = set()

    # 从占位符分析中提取
    for p in placeholder_analysis.get("report_number_placeholders", []):
        if "reportNumber" not in seen_fields:
            requirements["basic_info_fields"].append({
                "field": "reportNumber",
                "field_name": "报告编号",
                "placeholder": p["text"],
                "context": p["context"],
                "required": True,
            })
            seen_fields.add("reportNumber")

    for p in placeholder_analysis.get("x_pattern_placeholders", []):
        ftype = field_map.get(p["type"], "unknown")
        if ftype not in seen_fields:
            requirements["basic_info_fields"].append({
                "field": ftype,
                "field_name": p["type"].replace("占位符", ""),
                "placeholder": p["text"],
                "context": p["context"],
                "required": True,
            })
            seen_fields.add(ftype)

    # 签名日期
    for p in placeholder_analysis.get("date_placeholders", []):
        requirements["signature_dates"].append({
            "placeholder": p["text"],
            "context": p["context"],
            "required": True,
        })

    # 需要填充的表格
    for tbl in table_analysis:
        if tbl["empty_rows"] > 0 and tbl["data_rows"] > 0:
            requirements["tables_to_fill"].append({
                "table_index": tbl["table_index"],
                "title": tbl["table_title"],
                "header": tbl["header_row"],
                "empty_rows_count": tbl["empty_rows"],
                "total_rows": tbl["total_rows"],
            })

    # 汇总
    requirements["summary"] = {
        "total_basic_info_fields": len(requirements["basic_info_fields"]),
        "total_signature_dates": len(requirements["signature_dates"]),
        "total_tables_to_fill": len(requirements["tables_to_fill"]),
        "total_placeholders_found": (
            len(placeholder_analysis.get("report_number_placeholders", []))
            + len(placeholder_analysis.get("x_pattern_placeholders", []))
            + len(placeholder_analysis.get("date_placeholders", []))
        ),
    }

    return requirements


# ─── 辅助函数 ───

def extract_all_texts(xml_str: str) -> List[str]:
    """从 XML 中提取所有 <w:t> 文本"""
    texts = []
    for match in re.finditer(r"<w:t[^>]*>(.*?)</w:t>", xml_str):
        text = match.group(1)
        # 处理 XML 实体
        text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        texts.append(text)
    return texts


# ─── 主函数 ───

def main():
    parser = argparse.ArgumentParser(
        description="分析模板 .docx 文件，精确找出需要补充的内容"
    )
    parser.add_argument("template_path", help="模板 .docx 文件路径")
    parser.add_argument("--output", "-o", default=None, help="输出 JSON 结果文件路径")
    args = parser.parse_args()

    template_path = Path(args.template_path)
    if not template_path.exists():
        print(f"错误: 文件不存在: {template_path}")
        sys.exit(1)

    print(f"📄 分析模板: {template_path.name}")
    print("=" * 60)

    # 读取 XML
    xml_str, filename = read_docx_xml(str(template_path))
    print(f"   文件大小: {template_path.stat().st_size / 1024:.1f} KB")

    # 1. 占位符分析
    print("\n" + "─" * 60)
    print("🔍 1. 占位符检测")
    print("─" * 60)
    placeholder_analysis = analyze_placeholders(xml_str)

    all_placeholders = (
        placeholder_analysis["report_number_placeholders"]
        + placeholder_analysis["x_pattern_placeholders"]
        + placeholder_analysis["date_placeholders"]
    )

    if not all_placeholders:
        print("   ✅ 未发现占位符（文档可能已完全填充）")
    else:
        print(f"   发现 {len(all_placeholders)} 个占位符:\n")

        for p in placeholder_analysis["report_number_placeholders"]:
            print(f"   📋 报告编号: \"{p['text']}\"")
            print(f"      上下文: {p['context']}")
            print()

        for p in placeholder_analysis["x_pattern_placeholders"]:
            print(f"   ✏️  {p['type']}: \"{p['text']}\" ({p['len']}个X)")
            print(f"      上下文: {p['context']}")
            print()

        for p in placeholder_analysis["date_placeholders"]:
            print(f"   📅 日期占位符: \"{p['text']}\"")
            print(f"      上下文: {p['context']}")
            print()

    # 2. 表格分析
    print("─" * 60)
    print("📊 2. 表格结构分析")
    print("─" * 60)
    table_analysis = analyze_tables(xml_str)

    print(f"   文档中共有 {len(table_analysis)} 个表格\n")
    for tbl in table_analysis:
        print(f"   表格 {tbl['table_index']}: {tbl['table_title']}")
        print(f"      总行数: {tbl['total_rows']}  |  有数据行: {tbl['data_rows']}  |  空行: {tbl['empty_rows']}")
        print(f"      表头: {' | '.join(tbl['header_row'][:5])}{'...' if len(tbl['header_row']) > 5 else ''}")

        # 标记需要填充的表格
        if tbl["empty_rows"] > 0:
            print(f"      ⚠️  需要填充 {tbl['empty_rows']} 行数据")
        else:
            print(f"      ✅ 表格已完整")
        print()

    # 3. 文本结构分析
    print("─" * 60)
    print("📝 3. 文本结构分析")
    print("─" * 60)
    text_analysis = analyze_text_structure(xml_str)

    print(f"   总段落数: {text_analysis['total_paragraphs']}")
    print(f"   标题段落: {len(text_analysis['headings'])}")
    if text_analysis["headings"]:
        for h in text_analysis["headings"]:
            print(f"      {h['style']}: {h['text'][:60]}")

    # 4. 需要补充的内容汇总
    print("\n" + "=" * 60)
    print("📋 4. 需要补充的内容汇总")
    print("=" * 60)

    requirements = generate_fill_requirements(
        placeholder_analysis, table_analysis, text_analysis
    )

    print(f"\n   📌 基础信息字段 ({requirements['summary']['total_basic_info_fields']} 项):")
    for f in requirements["basic_info_fields"]:
        print(f"      - {f['field_name']} ({f['field']}): 占位符 \"{f['placeholder']}\"")

    print(f"\n   📅 签名日期 ({requirements['summary']['total_signature_dates']} 项):")
    for d in requirements["signature_dates"]:
        print(f"      - \"{d['placeholder']}\"")

    print(f"\n   📊 待填充表格 ({requirements['summary']['total_tables_to_fill']} 个):")
    for t in requirements["tables_to_fill"]:
        print(f"      - 表格{t['table_index']}: {t['title']} (需填充 {t['empty_rows_count']} 行)")

    # 输出 JSON
    if args.output:
        output_path = Path(args.output)
        full_result = {
            "template_file": filename,
            "placeholder_analysis": {
                k: v for k, v in placeholder_analysis.items()
            },
            "table_analysis": table_analysis,
            "text_analysis": {
                "total_paragraphs": text_analysis["total_paragraphs"],
                "heading_count": len(text_analysis["headings"]),
                "headings": [h["text"] for h in text_analysis["headings"]],
            },
            "fill_requirements": requirements,
        }
        output_path.write_text(
            json.dumps(full_result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\n   JSON 结果已保存到: {output_path}")

    print("\n" + "=" * 60)
    print("✅ 分析完成")


if __name__ == "__main__":
    register_namespaces()
    main()
