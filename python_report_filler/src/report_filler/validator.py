"""
XML 格式校验模块 — 对应 TS xml-validator.ts

校验填充后 document.xml 的表格结构完整性。
用 lxml Element Tree 替代正则标签计数。
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from lxml import etree

from report_filler.xml_utils import (
    qn,
    NSMAP,
    all_tables,
    table_rows,
    row_cells,
)

logger = logging.getLogger("report_filler.validator")

# ============================================================
# 校验结果
# ============================================================


class ValidationResult:
    """校验结果 — 对应 TS ValidationResult"""

    def __init__(self):
        self.valid: bool = True
        self.errors: list[str] = []
        self.warnings: list[str] = []


# ============================================================
# XML 语法校验
# ============================================================


def validate_document_xml(xml_str: str) -> ValidationResult:
    """校验 document.xml 的 XML 语法和表格结构完整性

    检查项：
      1. XML 可被 lxml 正确解析
      2. 每个表格至少包含 1 行
      3. 每行 w:tc 与 w:p 结构完整

    Args:
        xml_str: document.xml 完整文本

    Returns:
        ValidationResult
    """
    result = ValidationResult()

    # 1. 尝试解析 XML
    try:
        root = etree.fromstring(xml_str.encode("utf-8"))
    except etree.XMLSyntaxError as e:
        result.valid = False
        result.errors.append(f"XML 语法错误: {e}")
        return result

    # 2. 表格标签配对检查（用 lxml 则无法检测未闭合标签，但可以用原始文本正则兜底）
    tbl_open = len(re.findall(r"<w:tbl[ >]", xml_str))
    tbl_close = len(re.findall(r"</w:tbl>", xml_str))
    if tbl_open != tbl_close:
        result.valid = False
        result.errors.append(
            f"表格标签不配对: <w:tbl> {tbl_open} 个, </w:tbl> {tbl_close} 个"
        )

    tr_open = len(re.findall(r"<w:tr[ >]", xml_str))
    tr_close = len(re.findall(r"</w:tr>", xml_str))
    if tr_open != tr_close:
        result.valid = False
        result.errors.append(
            f"行标签不配对: <w:tr> {tr_open} 个, </w:tr> {tr_close} 个"
        )

    # 3. 逐个表格结构检查
    tables = all_tables(root)
    for tbl_idx, table in enumerate(tables, 1):
        rows = table_rows(table)
        if not rows:
            result.warnings.append(f"表格 #{tbl_idx}: 不包含任何行")
            continue

        for tr_idx, row in enumerate(rows, 1):
            cells = row_cells(row)

            # 检查每行单元格标签配对
            row_xml = etree.tostring(row, encoding="unicode")
            tc_open = len(re.findall(r"<w:tc[ >]", row_xml))
            tc_close = len(re.findall(r"</w:tc>", row_xml))
            if tc_open != tc_close:
                result.valid = False
                result.errors.append(
                    f"表格 #{tbl_idx} 行 #{tr_idx}: 单元格标签不配对 "
                    f"(<w:tc> {tc_open} 个, </w:tc> {tc_close} 个)"
                )

    return result


# ============================================================
# 表格结构对比校验
# ============================================================


def compare_table_structure(
    before_xml: str, after_xml: str
) -> ValidationResult:
    """对比填充前后表格结构一致性 — 对应 TS compareTableStructure

    检查项：
      1. 表格总数不变
      2. 每个表格列数不变（第一行 <w:tc> 数量）
      3. 每个表格行数只增不减

    Args:
        before_xml: 填充前 document.xml 文本
        after_xml: 填充后 document.xml 文本

    Returns:
        ValidationResult
    """
    result = ValidationResult()

    before_tables = _extract_table_infos(before_xml)
    after_tables = _extract_table_infos(after_xml)

    # 1. 表格总数
    if len(before_tables) != len(after_tables):
        result.valid = False
        result.errors.append(
            f"表格总数不一致: 填充前 {len(before_tables)} 个, "
            f"填充后 {len(after_tables)} 个"
        )

    # 2. 逐表对比
    max_len = max(len(before_tables), len(after_tables))
    for i in range(max_len):
        b = before_tables[i] if i < len(before_tables) else None
        a = after_tables[i] if i < len(after_tables) else None

        if b is None:
            result.valid = False
            result.errors.append(f"表格 #{i + 1}: 填充前不存在，填充后新增")
            continue
        if a is None:
            result.valid = False
            result.errors.append(f"表格 #{i + 1}: 填充前存在，填充后丢失")
            continue

        # 列数对比
        if b["col_count"] != a["col_count"]:
            result.valid = False
            result.errors.append(
                f"表格 #{i + 1}: 列数不一致 "
                f"(填充前 {b['col_count']} 列, 填充后 {a['col_count']} 列)"
            )

        # 行数对比
        if a["row_count"] < b["row_count"]:
            result.valid = False
            result.errors.append(
                f"表格 #{i + 1}: 行数减少 "
                f"(填充前 {b['row_count']} 行, 填充后 {a['row_count']} 行)"
            )
        elif a["row_count"] > b["row_count"]:
            result.warnings.append(
                f"表格 #{i + 1}: 行数增加 "
                f"(填充前 {b['row_count']} 行, 填充后 {a['row_count']} 行)"
            )

    return result


def _extract_table_infos(xml_str: str) -> list[dict]:
    """从 XML 文本中提取所有表格的列数和行数 — 对应 TS extractTableInfos"""
    infos: list[dict] = []

    try:
        root = etree.fromstring(xml_str.encode("utf-8"))
    except etree.XMLSyntaxError:
        return infos

    for table in all_tables(root):
        rows = table_rows(table)
        row_count = len(rows)

        # 第一行列数
        col_count = 0
        if rows:
            col_count = len(row_cells(rows[0]))

        infos.append({"col_count": col_count, "row_count": row_count})

    return infos


# ============================================================
# 目录结构校验
# ============================================================


def validate_structure_integrity(unpack_dir: str) -> ValidationResult:
    """校验 docx 解压目录结构完整性 — 对应 TS validateStructureIntegrity"""
    result = ValidationResult()
    base = Path(unpack_dir)

    required_files = [
        "[Content_Types].xml",
        "word/document.xml",
        "_rels/.rels",
    ]

    for f in required_files:
        if not (base / f).exists():
            result.valid = False
            result.errors.append(f"缺少必要文件: {f}")

    doc_rels = base / "word" / "_rels" / "document.xml.rels"
    if not doc_rels.exists():
        result.warnings.append("缺少 word/_rels/document.xml.rels")

    return result


# ============================================================
# 聚合校验入口
# ============================================================


def validate_filled_document(
    before_xml: str,
    after_xml: str,
    unpack_dir: str,
) -> ValidationResult:
    """聚合校验入口 — 对应 TS validateFilledDocument

    执行顺序：
      1. 目录结构检查
      2. XML 语法检查
      3. 表格一致性对比

    Returns:
        ValidationResult
    """
    all_errors: list[str] = []
    all_warnings: list[str] = []

    logger.info("开始格式校验...")

    # 1. 目录结构
    struct_result = validate_structure_integrity(unpack_dir)
    all_errors.extend(struct_result.errors)
    all_warnings.extend(struct_result.warnings)
    logger.info(f"  [1/3] 目录结构: {'通过' if struct_result.valid else '失败'}")

    # 2. XML 语法
    xml_result = validate_document_xml(after_xml)
    all_errors.extend(xml_result.errors)
    all_warnings.extend(xml_result.warnings)
    logger.info(f"  [2/3] XML 语法: {'通过' if xml_result.valid else '失败'}")

    # 3. 表格一致性
    compare_result = compare_table_structure(before_xml, after_xml)
    all_errors.extend(compare_result.errors)
    all_warnings.extend(compare_result.warnings)
    logger.info(f"  [3/3] 表格一致性: {'通过' if compare_result.valid else '失败'}")

    final = ValidationResult()
    final.valid = len(all_errors) == 0
    final.errors = all_errors
    final.warnings = all_warnings

    if final.valid:
        logger.info(f"格式校验通过 ({len(all_warnings)} 个警告)")
    else:
        logger.error(f"格式校验失败: {'; '.join(all_errors)}")

    return final
