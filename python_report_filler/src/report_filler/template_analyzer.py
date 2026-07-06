"""
模板结构分析器 — 对应 TS template-analyzer.service.ts

分析 .docx 模板的 document.xml，产出 TemplateStructure。
用 lxml Element Tree 替代正则匹配。

核心功能：
  1. 遍历所有表格，识别表格类型（KV/列表/混合表）
  2. 提取表头列名、KV 标签、签名行位置
  3. 提取占位符字段映射
"""

from __future__ import annotations

import re
from typing import Optional

from lxml import etree

from report_filler.models import (
    TemplateStructure,
    TemplateSection,
    TemplateTableInfo,
    PlaceholderField,
)
from report_filler.xml_utils import (
    qn,
    all_tables,
    table_rows,
    row_cells,
    cell_merged_text,
    cell_is_empty,
    cell_gridspan,
    cell_vmerge_status,
    is_key_value_table,
    is_nested_kv_table,
    analyze_row_cells,
    extract_table_title_from_paragraphs,
    _LIST_HEADER_KEYWORDS,
)

# ============================================================
# 占位符模式定义（与 TS filler.service.ts PLACEHOLDER_MAP 对齐）
# ============================================================

# 占位符正则 → 字段名映射
PLACEHOLDER_PATTERNS = [
    (re.compile(r"XXXXX-XXXX-XXXX-20\dX"), "report_number"),
    (re.compile(r"XXXXXXXXXXXX(?!公司)"), "device_name"),
    (re.compile(r"XXXXXXX公司"), "company_name"),
    (re.compile(r"XXXXXXXXX/XXXXXXXX/XXXXX/XXXXXX"), "report_type_prefix"),
    (re.compile(r"20\dX年\d{1,2}月-20\dX年\d{1,2}月"), "inspection_date_range"),
    (re.compile(r"20\dX年\d{1,2}月\d{1,2}日"), "signature_date"),
]


class TemplateAnalyzer:
    """模板结构分析器 — 对应 TS TemplateAnalyzer"""

    def __init__(self, tree: etree._Element):
        """
        Args:
            tree: document.xml 的 lxml ElementTree 根节点
        """
        self._tree = tree
        self._tables = all_tables(tree)
        self._used_titles: set[str] = set()  # 标题去重集合

    # ============================================================
    # 主入口
    # ============================================================

    def analyze(self) -> TemplateStructure:
        """主入口：分析整个模板结构

        Returns:
            TemplateStructure { sections: [TemplateSection, ...] }
        """
        sections: list[TemplateSection] = []

        # 1. 占位符字段分析
        placeholder_section = self._analyze_placeholders()
        if placeholder_section.placeholder_fields:
            sections.append(placeholder_section)

        # 2. 遍历所有表格
        for tbl_idx, table in enumerate(self._tables):
            section = self._build_section(table, tbl_idx)
            if section:
                sections.append(section)

        return TemplateStructure(sections=sections)

    # ============================================================
    # 占位符分析
    # ============================================================

    def _analyze_placeholders(self) -> TemplateSection:
        """提取文档中的占位符字段"""
        fields: list[PlaceholderField] = []
        seen_fields: set[str] = set()

        for wt in self._tree.xpath(".//w:t", namespaces={"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}):
            text = (wt.text or "").strip()
            if not text:
                continue

            for pattern, field_name in PLACEHOLDER_PATTERNS:
                if pattern.search(text) and field_name not in seen_fields:
                    seen_fields.add(field_name)
                    fields.append(PlaceholderField(
                        map_to=field_name,
                        pattern=pattern.pattern,
                    ))
                    break  # 一个文本只匹配一个占位符

        return TemplateSection(
            section_id="_placeholders",
            placeholder_fields=fields,
        )

    # ============================================================
    # 单表格分析：构建 TemplateSection
    # ============================================================

    def _build_section(
        self, table: etree._Element, table_index: int
    ) -> Optional[TemplateSection]:
        """分析单个表格，构建 TemplateSection"""

        rows = table_rows(table)
        if not rows:
            return None

        is_kv = is_key_value_table(table)
        # 检测是否为嵌套KV表（Row0像列表头但数据行有vMerge嵌套）
        is_nested = is_nested_kv_table(table)

        # 提取表格标题（使用全局去重集合）
        title = extract_table_title_from_paragraphs(
            self._tree, table,
            used_titles=getattr(self, '_used_titles', None),
        )

        # 提取签名字段
        sig_fields = self._extract_signature_fields(rows)

        # 判断是否为混合表
        is_hybrid, hybrid_header_rows, kv_keys = self._detect_hybrid_table(rows, is_kv)

        if is_hybrid:
            # 混合表：提取 KV 标签 + 列表头
            return self._build_hybrid_section(
                rows, table_index, title, sig_fields, is_hybrid,
                hybrid_header_rows, kv_keys,
            )

        if is_kv:
            # 纯 KV 表（含嵌套KV表）
            if is_nested:
                kv_keys_all = self._extract_nested_kv_keys(rows)
            else:
                kv_keys_all = self._extract_kv_keys_from_table(rows)
            return TemplateSection(
                section_id=f"tbl_{table_index}",
                placeholder_fields=[],
                tables=[TemplateTableInfo(
                    table_index=table_index,
                    is_key_value=True,
                    is_nested_kv=is_nested,
                    kv_keys=kv_keys_all,
                )],
                signature_position={"table_index": table_index} if sig_fields else None,
                signature_fields=sig_fields,
            )

        # 列表表
        headers, header_rows = self._extract_list_headers(rows)
        columns = [{"header": h, "mapped_field": h} for h in headers] if headers else []

        return TemplateSection(
            section_id=f"tbl_{table_index}",
            placeholder_fields=[],
            tables=[TemplateTableInfo(
                table_index=table_index,
                is_key_value=False,
                columns=columns,
            )],
            signature_position={"table_index": table_index} if sig_fields else None,
            signature_fields=sig_fields,
        )

    # ============================================================
    # 混合表检测
    # ============================================================

    def _detect_hybrid_table(
        self, rows: list[etree._Element], is_kv: bool
    ) -> tuple[bool, int, list[str]]:
        """检测表格是否为混合表（KV + 列表 + 签名）

        条件：
          - 行数 >= 4
          - Row 0 是 KV 行
          - 最后一行是签名行 or 连续 KV 行 >= 2

        Returns:
            (is_hybrid, hybrid_header_rows, kv_keys)
        """
        if len(rows) < 4:
            return False, 0, []

        if is_kv:
            # 纯 KV 表已被 is_key_value_table 分类，不在此处重复
            # 但如果是混合表（有列表数据区），应该进一步分析
            pass

        # 分析 Row 0
        r0 = analyze_row_cells(rows[0])

        # 检查 Row 0 是否为 KV 行
        if not r0.is_kv_row:
            return False, 0, []

        # 计数连续 KV 行
        kv_keys: list[str] = []
        consecutive_kv_rows = 0

        for r_idx, row in enumerate(rows):
            analysis = analyze_row_cells(row)
            if analysis.is_kv_row and not analysis.is_header_row:
                consecutive_kv_rows += 1
                # 提取 KV 标签（兼容 vMerge）
                self._collect_kv_keys_from_analysis(analysis, kv_keys)
            else:
                break

        # 检测最后一行是否为签名行
        last_analysis = analyze_row_cells(rows[-1])
        last_is_sig = last_analysis.is_signature_row

        # 混合表判定
        if consecutive_kv_rows >= 1 and len(rows) >= 4 and (last_is_sig or consecutive_kv_rows >= 2):
            # 确定列表头行数
            list_header_rows = 0
            for r_idx in range(consecutive_kv_rows, len(rows)):
                analysis = analyze_row_cells(rows[r_idx])
                if analysis.is_signature_row:
                    break
                if analysis.is_header_row:
                    list_header_rows += 1
                elif analysis.is_merge_title_row:
                    # 合并标题行也计入表头
                    list_header_rows += 1
                else:
                    # 遇到数据行就停止
                    break

            return True, list_header_rows, list(set(kv_keys))

        return False, 0, []

    def _collect_kv_keys_from_analysis(
        self, analysis: 'RowAnalysis', keys: list[str]
    ) -> None:
        """从 RowAnalysis 中收集 KV 标签"""
        cells = analysis.cells
        for i in range(0, len(cells) - 1, 2):
            if cells[i].v_merge == "continue":
                continue
            label = cells[i].text
            if label and len(label) > 0 and len(label) < 50 and not label.isdigit():
                if label not in _LIST_HEADER_KEYWORDS:
                    keys.append(label)

    # ============================================================
    # 混合表 Section 构建
    # ============================================================

    def _build_hybrid_section(
        self,
        rows: list[etree._Element],
        table_index: int,
        title: str,
        sig_fields: list[str],
        is_hybrid: bool,
        hybrid_header_rows: int,
        kv_keys: list[str],
    ) -> TemplateSection:
        """为混合表构建 TemplateSection"""
        # 找列表头行
        list_headers, list_header_rows = self._extract_hybrid_list_headers(
            rows, hybrid_header_rows
        )
        columns = [{"header": h, "mapped_field": h} for h in list_headers]

        return TemplateSection(
            section_id=f"tbl_{table_index}",
            placeholder_fields=[],
            tables=[TemplateTableInfo(
                table_index=table_index,
                is_key_value=True,  # 混合表也标记为 KV
                is_hybrid=True,
                hybrid_list_header_rows=hybrid_header_rows or list_header_rows,
                kv_keys=kv_keys,
                columns=columns,
            )],
            signature_position={"table_index": table_index} if sig_fields else None,
            signature_fields=sig_fields,
        )

    # ============================================================
    # 列表表头提取
    # ============================================================

    def _extract_list_headers(
        self, rows: list[etree._Element]
    ) -> tuple[list[str], int]:
        """从列表型表格中提取表头

        Returns:
            (headers, header_row_count)
        """
        if not rows:
            return [], 0

        # 从第一行提取
        first_row_cells = row_cells(rows[0])
        headers = [cell_merged_text(c) for c in first_row_cells]

        # 过滤掉空标题和短标题
        valid_headers = [h for h in headers if h and len(h) > 0]

        return valid_headers, 1

    def _extract_hybrid_list_headers(
        self, rows: list[etree._Element], kv_row_count: int
    ) -> tuple[list[str], int]:
        """从混合表中提取列表头（跳过 KV 行）

        Returns:
            (headers, header_row_count)
        """
        header_rows_count = 0
        all_headers: list[str] = []

        for r_idx in range(kv_row_count, len(rows)):
            analysis = analyze_row_cells(rows[r_idx])
            if analysis.is_signature_row:
                break
            if analysis.is_header_row or analysis.is_merge_title_row:
                header_rows_count += 1
                row_texts = [c.text for c in analysis.cells if c.v_merge != "continue"]
                valid = [h for h in row_texts if h and len(h) > 0]
                if valid:
                    all_headers = valid  # 用最后一层表头覆盖
            else:
                break

        return all_headers, header_rows_count

    # ============================================================
    # KV 标签提取（纯 KV 表）
    # ============================================================

    def _extract_kv_keys_from_table(
        self, rows: list[etree._Element]
    ) -> list[str]:
        """从纯 KV 表格中提取所有键值对的标签

        遍历所有行，偶数位（0, 2, 4...）为标签。
        过滤空标签、纯数字、过长文本。去重。
        """
        keys: list[str] = []
        seen: set[str] = set()

        # 智能起始索引判断
        kv_start_idx = self._determine_kv_start(rows)

        for row in rows[kv_start_idx:]:
            texts = [cell_merged_text(c) for c in row_cells(row)]

            for i in range(0, len(texts) - 1, 2):
                label = texts[i]
                if (
                    label
                    and len(label) > 0
                    and len(label) < 50
                    and not label.isdigit()
                    and label not in _LIST_HEADER_KEYWORDS
                    and label not in seen
                ):
                    keys.append(label)
                    seen.add(label)

        return keys

    def _determine_kv_start(self, rows: list[etree._Element]) -> int:
        """判断 KV 行起始索引（跳过标题行/类别列）"""
        if not rows:
            return 0

        first_texts = [cell_merged_text(c) for c in row_cells(rows[0])]

        # 奇数格且首格含 vMerge → 从索引1开始（跳过类别列）
        if len(first_texts) % 2 != 0 and cell_vmerge_status(
            row_cells(rows[0])[0]
        ) == "restart":
            return 1

        return 0

    # ============================================================
    # 嵌套 KV 表提取（vMerge 层级结构）
    # ============================================================

    def _extract_nested_kv_keys(
        self, rows: list[etree._Element]
    ) -> list[str]:
        """从嵌套KV表中提取所有Key标签（含vMerge层级结构的表格）

        典型场景：检查项目明细表，Row0是列表头[序号|检查项目|结果|备注]，
        数据行有3层vMerge嵌套（大类→子类→具体项目）。

        策略：
          1. 跳过 Row0 (表头行)
          2. 检测并跳过"类别标题行"（4格, gridSpan>=4, 无vMerge）
          3. 从有效数据行提取每行最后一个有意义文本作为 KEY
          4. 排除 vMerge=continue、纯数字(序号)、已见过的key
        """
        keys: list[str] = []
        seen: set[str] = set()

        for row in rows[1:]:  # 跳过表头
            cells = row_cells(row)

            # === 检测类别标题行 (Section Header Rows) ===
            # 特征: 只有<=4格, C1的gridSpan>=4, 无vMerge单元格
            # 这些是大类标题如 "3 防腐层检查"、"6 壁厚测定" 等
            if len(cells) <= 4:
                c1_gs = cell_gridspan(cells[1]) if len(cells) > 1 else 1
                has_vmerge = any(cell_vmerge_status(c) != "none" for c in cells)
                if c1_gs >= 4 and not has_vmerge:
                    continue  # 跳过类别标题行!

            # === 从数据行提取KEY ===
            # 策略: 找到最后一个有实际文本的非空、非序号、非vM=continue 的单元格
            candidate_key: Optional[str] = None

            for ci, cell in enumerate(cells):
                vm = cell_vmerge_status(cell)
                text = cell_merged_text(cell).strip()

                if vm == "continue":
                    continue
                if not text or text in ("(empty)", ""):
                    continue
                if text.isdigit():  # 跳过序号列 C0
                    continue

                # 记录最后一个有意义的文本作为候选 key
                candidate_key = text

            if candidate_key and candidate_key not in seen:
                keys.append(candidate_key)
                seen.add(candidate_key)

        return keys

    # ============================================================
    # 签名行检测
    # ============================================================

    def _extract_signature_fields(
        self, rows: list[etree._Element]
    ) -> list[str]:
        """从表格最后一行提取签名字段标签"""
        if not rows:
            return []

        last_row = rows[-1]
        analysis = analyze_row_cells(last_row)

        if analysis.is_signature_row:
            texts = [c.text for c in analysis.cells if not c.is_empty]
            return texts

        return []


# Re-export for type hints
from report_filler.xml_utils import RowAnalysis  # noqa: E402
