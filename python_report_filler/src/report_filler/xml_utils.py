"""
XML 工具模块 — 基于 lxml XPath 的 WordprocessingML 操作集

替代 TypeScript xml-utils.ts 中所有基于正则的 XML 解析。
核心原则：全程使用 lxml Element Tree + XPath，仅在占位符模式匹配中保留正则。

命名空间常量:
    WORDML_NS  — wordprocessingml 主命名空间
    NSMAP      — XPath 查询用的命名空间前缀映射
"""

from __future__ import annotations

import re
from typing import Optional

from lxml import etree

# ============================================================
# 命名空间常量
# ============================================================

WORDML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NSMAP = {"w": WORDML_NS}


def qn(tag: str) -> str:
    """生成带命名空间的标签名（用于 Element.find / findall）

    Example:
        qn("w:tbl") → "{http://schemas.openxmlformats.org/...}tbl"
    """
    if tag.startswith("{"):
        return tag
    if ":" in tag:
        prefix, local = tag.split(":", 1)
        ns = {"w": WORDML_NS}.get(prefix)
        if ns:
            return f"{{{ns}}}{local}"
    return tag


# ============================================================
# 表格级操作
# ============================================================


def all_tables(tree: etree._Element) -> list[etree._Element]:
    """获取文档中所有 <w:tbl> 元素（按文档顺序）"""
    return tree.xpath("//w:tbl", namespaces=NSMAP)


def table_rows(table: etree._Element) -> list[etree._Element]:
    """获取表格中所有 <w:tr> 行"""
    return table.findall(qn("w:tr"))


def table_row_count(table: etree._Element) -> int:
    """获取表格行数"""
    return len(table.findall(qn("w:tr")))


# ============================================================
# 行级操作
# ============================================================


def row_cells(row: etree._Element) -> list[etree._Element]:
    """获取行中所有 <w:tc> 单元格（物理顺序）"""
    return row.findall(qn("w:tc"))


# ============================================================
# 单元格级操作
# ============================================================


def cell_texts(cell: etree._Element) -> list[str]:
    """提取单元格中所有 <w:t> 的纯文本列表（每个 run 一段）"""
    texts: list[str] = []
    for wt in cell.findall(".//w:t", NSMAP):
        t = (wt.text or "").strip()
        if t and not t.startswith("<"):
            texts.append(t)
    return texts


def cell_merged_text(cell: etree._Element) -> str:
    """将单元格中所有 <w:t> 拼接为单个字符串（处理 Word 拆分文本）"""
    return "".join(cell_texts(cell))


def cell_is_empty(cell: etree._Element) -> bool:
    """判断单元格是否为空（无文本内容）"""
    text = cell_merged_text(cell)
    return not text or text.isspace()


def cell_gridspan(cell: etree._Element) -> int:
    """获取单元格的 gridSpan 属性值（默认为 1）"""
    gs = cell.get(qn("w:gridSpan"))
    if gs is not None:
        try:
            return int(gs)
        except ValueError:
            pass
    # 也尝试从 <w:tcPr><w:gridSpan> 子元素获取
    tc_pr = cell.find(qn("w:tcPr"))
    if tc_pr is not None:
        gs_el = tc_pr.find(qn("w:gridSpan"))
        if gs_el is not None:
            val = gs_el.get(qn("w:val"))
            if val:
                try:
                    return int(val)
                except ValueError:
                    pass
    return 1


def cell_vmerge_status(cell: etree._Element) -> str:
    """获取单元格的 vMerge 状态: "none" | "restart" | "continue"

    检测路径:
        <w:tcPr><w:vMerge w:val="restart"/>  → restart
        <w:tcPr><w:vMerge/> 或 w:val="continue" → continue
        无 <w:vMerge> → none
    """
    tc_pr = cell.find(qn("w:tcPr"))
    if tc_pr is None:
        return "none"

    vmerge = tc_pr.find(qn("w:vMerge"))
    if vmerge is None:
        return "none"

    val = vmerge.get(qn("w:val"))
    if val == "restart":
        return "restart"
    # 无 val 属性 → continue; val="continue" → continue
    return "continue"


def is_vmerge_continue(cell: etree._Element) -> bool:
    """单元格是否是垂直合并的后续行"""
    return cell_vmerge_status(cell) == "continue"


def is_vmerge_restart(cell: etree._Element) -> bool:
    """单元格是否是垂直合并的起始行"""
    return cell_vmerge_status(cell) == "restart"


# ============================================================
# 行分析（替代 TS analyzeRowCells）
# ============================================================


class CellInfo:
    """单元格分析信息 — 对应 TS CellInfo"""

    __slots__ = ("text", "grid_span", "v_merge", "is_empty", "physical_index")

    def __init__(
        self,
        text: str = "",
        grid_span: int = 1,
        v_merge: str = "none",
        is_empty: bool = True,
        physical_index: int = 0,
    ):
        self.text = text
        self.grid_span = grid_span
        self.v_merge = v_merge
        self.is_empty = is_empty
        self.physical_index = physical_index

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "grid_span": self.grid_span,
            "v_merge": self.v_merge,
            "is_empty": self.is_empty,
            "physical_index": self.physical_index,
        }


class RowAnalysis:
    """行分析结果 — 对应 TS RowAnalysis"""

    __slots__ = (
        "cells",
        "logical_col_count",
        "physical_cell_count",
        "is_signature_row",
        "is_kv_row",
        "is_header_row",
        "is_merge_title_row",
    )

    def __init__(self):
        self.cells: list[CellInfo] = []
        self.logical_col_count: int = 0
        self.physical_cell_count: int = 0
        self.is_signature_row: bool = False
        self.is_kv_row: bool = False
        self.is_header_row: bool = False
        self.is_merge_title_row: bool = False


# 常见列表头关键词
_LIST_HEADER_KEYWORDS = frozenset([
    "序号", "编号", "检验项目", "检查项目", "检查内容", "检查结果",
    "页码", "附图", "备注", "日期", "检测结果", "处理措施",
    "事件类型", "位置", "深度", "壁厚", "规格型号",
])


def analyze_row_cells(row: etree._Element) -> RowAnalysis:
    """逐单元格分析行结构 — 对应 TS analyzeRowCells

    逐个解析每个 <w:tc> 的 gridSpan/vMerge 属性，判断行类型
    （KV行 / 列表头 / 签名行 / 合并标题行）。

    Args:
        row: <w:tr> Element

    Returns:
        RowAnalysis 行分析结果
    """
    result = RowAnalysis()
    cells = row_cells(row)
    result.physical_cell_count = len(cells)

    for phys_idx, cell in enumerate(cells):
        text = cell_merged_text(cell)
        gs = cell_gridspan(cell)
        vm = cell_vmerge_status(cell)
        empty = not text or text.isspace()

        result.cells.append(CellInfo(
            text=text,
            grid_span=gs,
            v_merge=vm,
            is_empty=empty,
            physical_index=phys_idx,
        ))

    # 逻辑列总数（gridSpan 展开）
    result.logical_col_count = sum(c.grid_span for c in result.cells)

    # 拼接所有文本用于行类型判断
    all_text = "".join(c.text for c in result.cells)

    # 签名行检测
    signature_pattern = re.compile(r"检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]")
    result.is_signature_row = bool(signature_pattern.search(all_text))

    # KV行检测（待填充后置 isHeaderRow 优先规则覆盖）
    result.is_kv_row = _detect_kv_row(result, all_text)

    # 表头行检测：排除 vMerge continue 后，大部分单元格非空
    header_cells = [c for c in result.cells if c.v_merge != "continue"]
    non_empty_headers = [c for c in header_cells if not c.is_empty]
    result.is_header_row = (
        len(non_empty_headers) >= 3
        and len(non_empty_headers) >= len(header_cells) * 0.7
    )

    # 表头行优先：如果同时满足 KV 行和表头行条件，优先判定为表头行
    if result.is_kv_row and result.is_header_row:
        result.is_kv_row = False

    # 合并标题行：gridSpan 覆盖大量列（≥4）且物理单元格少
    max_gs = max((c.grid_span for c in result.cells), default=0)
    result.is_merge_title_row = max_gs >= 4 and result.physical_cell_count <= 2

    return result


def _detect_kv_row(analysis: RowAnalysis, all_text: str) -> bool:
    """检测是否为 KV 行（标签-值交替配对模式）

    对应 TS analyzeRowCells 中的 isKvRow 分支逻辑。
    注意：用物理单元格数配对，不是逻辑列数。
    """
    if analysis.is_signature_row:
        return False
    if analysis.physical_cell_count < 4:
        return False
    if analysis.physical_cell_count % 2 != 0:
        return False

    cells = analysis.cells
    label_count = 0
    empty_value_count = 0

    # 排除纯符号标签的正则
    pure_symbol = re.compile(r"^[/\-—－_]+$")

    for i in range(0, len(cells) - 1, 2):
        label = cells[i].text
        value = cells[i + 1].text

        # 标签有效性判断
        is_valid_label = (
            label
            and len(label) > 0
            and len(label) < 50
            and not label.isdigit()
            and not pure_symbol.match(label.strip())
            and label not in _LIST_HEADER_KEYWORDS
        )
        if is_valid_label:
            label_count += 1
            if not value or value.isspace() or pure_symbol.match(value):
                empty_value_count += 1

    # 至少 2 个标签 + 至少一半值列为空 → KV 行
    return label_count >= 2 and empty_value_count >= label_count / 2


# ============================================================
# 表格类型判断（替代 TS isKeyValueTable）
# ============================================================


def is_key_value_table(table: etree._Element) -> bool:
    """判断表格是否为键值对类型 — 对应 TS isKeyValueTable

    键值对表格：每行是 "标签 | 值 | 标签 | 值" 交替排列。
    列表型表格：第一行全是列标题。
    嵌套KV表：Row0像列表头，但数据行有vMerge嵌套结构。

    Args:
        table: <w:tbl> Element

    Returns:
        是否为 KV 表格（含嵌套KV表）
    """
    rows = table_rows(table)
    if not rows:
        return False

    # 记录嵌套检测结果（供外部读取）
    nested_kv_detected = False

    # 检测 row 0 是否为合并标题行（≤2 个 cell），如果是则从 row 1 开始扫描
    start_row_idx = 0
    initial_list_verdict = False  # 是否被初步判定为列表表

    if len(rows) > 1:
        row0_texts = [cell_merged_text(c) for c in row_cells(rows[0])]
        row0_physical_cells = len(row_cells(rows[0]))

        if len(row0_texts) <= 2:
            # 合并标题行 → 跳过
            start_row_idx = 1
        elif len(row0_texts) >= 3:
            # 首行 ≥3 个非空单元格 → 检查是否为列表表头
            non_empty = [c for c in row0_texts if c and c.strip()]
            has_kw = any(c.strip() in _LIST_HEADER_KEYWORDS for c in row0_texts)
            if len(non_empty) >= len(row0_texts) * 0.75 and has_kw:
                initial_list_verdict = True  # 初步判定为列表表

    if start_row_idx >= len(rows):
        return False

    # === 二次验证：检测嵌套KV表 ===
    # 如果初步判定为列表表，检查数据行是否有 vMerge 嵌套特征
    if initial_list_verdict and len(rows) > 4:
        sample_rows = min(len(rows) - start_row_idx, 8)
        total_merge_cells = 0
        total_cells = 0
        gridspan_score = 0
        row0_physical = len(row_cells(rows[0]))

        for r in range(start_row_idx, start_row_idx + sample_rows):
            cells = row_cells(rows[r])
            total_cells += len(cells)
            for ci, cell in enumerate(cells):
                vm = cell_vmerge_status(cell)
                gs = cell_gridspan(cell)
                text = cell_merged_text(cell).strip()

                if vm != "none":
                    total_merge_cells += 1
                # 非 C0 的有内容跨列单元格是嵌套表的强信号
                if gs > 1 and ci > 0 and text:
                    gridspan_score += 1

        # 判定条件：
        # A. 数据行物理格数 > Row0 物理格数（说明展开了嵌套列）且 vMerge 占比高
        # B. 有大量非首列跨列单元格（gridspan_score）
        if total_cells > 8:  # 至少采样了足够多的单元格
            merge_ratio = total_merge_cells / total_cells
            data_rows_avg_cells = total_cells / sample_rows

            if (merge_ratio > 0.25 and data_rows_avg_cells > row0_physical) or gridspan_score >= 4:
                nested_kv_detected = True

    # 如果检测到嵌套KV特征，直接返回 True
    if nested_kv_detected:
        # 通过函数属性传递嵌套标记
        is_key_value_table.nested_cache[id(table)] = True
        return True

    # 多行扫描（至多 3 行），累积 KV 模式证据
    label_count = 0
    value_text_count = 0
    label_total_len = 0
    value_total_len = 0

    rows_to_check = min(len(rows) - start_row_idx, 3)
    for r in range(start_row_idx, start_row_idx + rows_to_check):
        row_texts = [cell_merged_text(c) for c in row_cells(rows[r])]

        for i in range(0, len(row_texts) - 1, 2):
            label_cell = row_texts[i]
            value_cell = row_texts[i + 1]

            if label_cell and len(label_cell) > 0 and not label_cell.isdigit() and len(label_cell) < 50:
                label_count += 1
                label_total_len += len(label_cell)

            if value_cell and len(value_cell) > 0 and not value_cell.isspace():
                value_text_count += 1
                value_total_len += len(value_cell)

    # 至少 2 个标签
    if label_count < 2:
        return False

    # 策略 1: 所有值列为空 → 明确是 KV 表（模板占位）
    if value_text_count == 0:
        return True

    # 策略 2: 标签短 vs 值长 → 键值对表
    if label_count > 0 and value_text_count > 0:
        avg_label = label_total_len / label_count
        avg_value = value_total_len / value_text_count
        if avg_label < 10 and avg_value > avg_label * 1.5:
            return True

    # 策略 3: 标签 ≥4 且至少一半值列为空
    if label_count >= 4 and value_text_count <= label_count / 2:
        return True

    return False


# 嵌套KV检测缓存（table id -> bool）
is_key_value_table.nested_cache: dict[int, bool] = {}


def is_nested_kv_table(table: etree._Element) -> bool:
    """检查表格是否被识别为嵌套KV表

    必须在调用 is_key_value_table() 之后使用。

    Args:
        table: <w:tbl> Element

    Returns:
        是否为嵌套KV表
    """
    return getattr(is_key_value_table, 'nested_cache', {}).get(id(table), False)


def count_key_value_pairs(table: etree._Element) -> dict:
    """统计键值对表格中的 KV 对数量和可填充单元格数 — 对应 TS countKeyValuePairs

    Returns:
        { "pair_count": int, "cell_count": int }
    """
    pair_count = 0
    cell_count = 0

    for row in table_rows(table):
        texts = [cell_merged_text(c) for c in row_cells(row)]

        for i in range(0, len(texts) - 1, 2):
            label = texts[i]
            value = texts[i + 1]
            if label and len(label) > 0:
                pair_count += 1
                if not value or value.isspace():
                    cell_count += 1

    return {"pair_count": pair_count, "cell_count": cell_count}


# ============================================================
# 占位符文本提取（保留正则的场景）
# ============================================================


def extract_all_texts(tree_or_element: etree._Element) -> list[str]:
    """提取所有 <w:t> 的纯文本列表 — 对应 TS extractAllTexts

    用 XPath 替代正则，性能更好。
    """
    texts: list[str] = []
    for wt in tree_or_element.xpath(".//w:t", namespaces=NSMAP):
        t = (wt.text or "").strip()
        if t and not t.startswith("<") and len(t) < 200:
            texts.append(t)
    return texts


def find_chapter_boundaries(tree: etree._Element) -> list[dict]:
    """识别文档中的章节边界 — 对应 TS findChapterBoundaries

    匹配模式：
        （1-1）章节标题  或  (1-1)  (1-1) 章节标题（带重复编号）

    Returns:
        [{"id": "1-1", "title": "原始资料审查报告", "start_index": 42}, ...]
    """
    chapters: list[dict] = []
    seen_ids: set[str] = set()

    # 章节编号模式
    double_pattern = re.compile(
        r"[（(]?\s*(\d+[-－]\d+)\s*[）)]?\s*[（(]?\s*\1\s*[）)]?\s*(.+)"
    )
    single_pattern = re.compile(
        r"[（(]\s*(\d+[-－]\d+)\s*[）)]\s*(.+)"
    )

    for wt in tree.xpath(".//w:t", namespaces=NSMAP):
        text = (wt.text or "").strip()
        if not text:
            continue

        cm = double_pattern.match(text)
        if not cm:
            cm = single_pattern.match(text)

        if cm:
            chapter_id = cm.group(1)
            if chapter_id not in seen_ids:
                seen_ids.add(chapter_id)
                chapters.append({
                    "id": chapter_id,
                    "title": text[:100],
                })

    return chapters


# ============================================================
# 文本注入（替代 TS injectTextIntoCell）
# ============================================================


def inject_text_into_cell(cell: etree._Element, text: str) -> bool:
    """向单元格中注入文本 — 对应 TS injectTextIntoCell

    按优先级尝试：
    1. 找到已有的 <w:t> 元素，替换其文本
    2. 向已有的 <w:r> 元素中添加 <w:t>
    3. 创建新的 <w:r> + <w:t> 子元素

    Args:
        cell: <w:tc> Element
        text: 要注入的文本

    Returns:
        是否成功注入
    """
    # Case 1: 已有 <w:t> 元素 → 替换文本
    wts = cell.findall(".//w:t", NSMAP)
    if wts:
        wts[0].text = text
        # 清空后续 <w:t>（保留元素但清空，保持 run 结构）
        for wt in wts[1:]:
            wt.text = ""
        return True

    # Case 2: 已有 <w:r> 元素，但没有 <w:t> → 添加 <w:t>
    runs = cell.findall(".//w:r", NSMAP)
    if runs:
        wt_el = etree.SubElement(runs[0], qn("w:t"))
        wt_el.text = text
        # 如果有 xml:space 属性，添加以保留空格
        wt_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        return True

    # Case 3: 完全空单元格 → 创建 <w:p> → <w:r> → <w:t>
    para = cell.find(qn("w:p"))
    if para is None:
        para = etree.SubElement(cell, qn("w:p"))

    run = etree.SubElement(para, qn("w:r"))
    wt_el = etree.SubElement(run, qn("w:t"))
    wt_el.text = text
    wt_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return True


# ============================================================
# 行克隆
# ============================================================


def clone_table_row(row: etree._Element) -> etree._Element:
    """深拷贝行元素（保留所有格式和样式）"""
    import copy
    return copy.deepcopy(row)


# ============================================================
# 表格标题提取
# ============================================================


def extract_table_title_from_paragraphs(
    tree: etree._Element, table: etree._Element, max_prev_paras: int = 5,
    used_titles: Optional[set[str]] = None,
) -> str:
    """从表格前的段落中提取表格标题

    在 WordprocessingML 中，表格标题通常是表格之前紧邻的段落。
    搜索表格元素之前的 <w:p> 元素。

    Args:
        tree: document.xml 根节点
        table: <w:tbl> Element
        max_prev_paras: 最多回溯几个段落（默认5，比原来2更大以覆盖更多场景）
        used_titles: 已使用的标题集合（用于去重）

    Returns:
        表格标题文本（无标题时返回空字符串）
    """
    body = tree.find(qn("w:body"))
    if body is None:
        return ""

    # 获取 body 中所有子元素（段落 + 表格）
    children = list(body)

    try:
        tbl_idx = children.index(table)
    except ValueError:
        return ""

    # 向前搜索 <w:p> 元素（增大回溯范围到 max_prev_paras=5）
    title_parts: list[str] = []
    prev_tables_encountered = 0
    for i in range(tbl_idx - 1, max(-1, tbl_idx - 1 - max_prev_paras * 3), -1):
        child = children[i]
        if child.tag == qn("w:p"):
            # 提取段落文本
            para_text = "".join(
                (wt.text or "").strip()
                for wt in child.findall(".//w:t", NSMAP)
                if wt.text
            )
            if para_text and para_text.strip():
                cleaned = para_text.strip()
                # 过滤掉占位符文本（如"报告编号：XXXXX-..."等模板占位内容）
                if any(pattern in cleaned for pattern in (
                    "XXXXX-XXXX-XXXX-20", "XXXXXXXXXXXX",
                    "XXXXXXX公司", "20X年", "202X年"
                )):
                    continue
                # 去重检查
                if used_titles and cleaned in used_titles:
                    continue
                title_parts.insert(0, cleaned)
        elif child.tag == qn("w:tbl"):
            prev_tables_encountered += 1
            # 遇到另一个表格时：如果还没收集到有效标题则继续向上搜索，
            # 否则停止
            if title_parts:
                break
            if prev_tables_encountered >= 2:
                break

    result = " - ".join(title_parts)
    # 记录已使用的标题
    if used_titles is not None and result:
        used_titles.add(result)
    return result
