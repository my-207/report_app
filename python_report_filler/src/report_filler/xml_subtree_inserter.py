"""
XML 子树插入引擎 — 对应 TS xml-subtree-inserter.service.ts

将数据行的文本填入模板表格行，保留所有原始样式。
核心原则：只操作 <w:t> 文本内容，不动结构、属性、样式。

用 lxml Element API 替代所有字符串操作。
"""

from __future__ import annotations

import copy
import re
from typing import Optional

from lxml import etree

from report_filler.models import SignatureBlock
from report_filler.xml_utils import (
    qn,
    NSMAP,
    all_tables,
    table_rows,
    row_cells,
    cell_merged_text,
    cell_texts,
    cell_is_empty,
    cell_gridspan,
    cell_vmerge_status,
    is_vmerge_continue,
    analyze_row_cells,
    inject_text_into_cell,
    clone_table_row,
)

# ============================================================
# 主入口：fillTableFromSource
# ============================================================


class XmlSubtreeInserter:
    """XML 子树插入引擎 — 对应 TS XmlSubtreeInserter"""

    def fill_table_from_source(
        self,
        tree: etree._Element,
        target_table_index: int,
        source_table: dict,
        data_start_row: int = 0,
        signature_block: Optional[SignatureBlock] = None,
    ) -> int:
        """将源数据填入目标表格 — 对应 TS fillTableFromSource

        Args:
            tree: document.xml 根节点 ElementTree
            target_table_index: 目标表格索引（从 0 开始）
            source_table: 源数据表格 {"headers": [...], "rows": [{...}, ...]}
            data_start_row: 数据起始行偏移（混合表中跳过 KV 行）
            signature_block: 签名数据块

        Returns:
            填充的行数
        """
        tables = all_tables(tree)
        if target_table_index >= len(tables):
            raise ValueError(f"表格索引 {target_table_index} 超出范围 (共 {len(tables)} 个表格)")

        target_table = tables[target_table_index]
        rows = table_rows(target_table)

        if len(rows) < 3:
            return 0  # 至少需要表头 + 1 数据行模板 + 签名行

        # 源数据
        data_headers = source_table.get("headers", [])
        data_rows = source_table.get("rows", [])

        if not data_rows:
            return 0

        # 1. 保留 KV 行（如果 dataStartRow > 0）
        preserved_rows = rows[:data_start_row] if data_start_row > 0 else []

        # 2. 智能识别表头区域
        header_start = data_start_row
        header_end = self._find_header_end(rows, header_start)

        template_data_rows = rows[header_end:]
        # 签名行是最后一行
        sig_row = template_data_rows[-1] if template_data_rows else None
        data_template_rows = template_data_rows[:-1] if sig_row else template_data_rows

        if not data_template_rows:
            return 0

        rows_filled = 0
        filled_data_rows: list[etree._Element] = []

        # 3. 填充数据行
        template_row = data_template_rows[0]
        for i in range(max(len(data_template_rows), len(data_rows))):
            if i < len(data_rows) and i < len(data_template_rows):
                # 源有数据 + 模板有空行 → 填入
                filled = self._fill_row_with_data(data_template_rows[i], data_headers, data_rows[i])
                filled_data_rows.append(filled)
                rows_filled += 1
            elif i < len(data_template_rows):
                # 模板还有空行但源无数据 → 保留空行
                filled_data_rows.append(data_template_rows[i])
            else:
                # 源数据超出模板行数 → 克隆模板第一行填充
                cloned = clone_table_row(template_row)
                filled = self._fill_row_with_data(cloned, data_headers, data_rows[i])
                filled_data_rows.append(filled)
                rows_filled += 1

        # 4. 填充签名行
        if sig_row is not None:
            if signature_block:
                filled_sig = self._fill_signature_row_direct(sig_row, signature_block)
            elif data_start_row > 0 and source_table.get("signature"):
                filled_sig = self._fill_row_with_data(
                    sig_row, data_headers, source_table["signature"]
                )
            else:
                filled_sig = sig_row
            filled_data_rows.append(filled_sig)

        # 5. 组装：清除旧行 + 插入保留行 + 表头行 + 新数据行
        self._replace_rows(
            target_table,
            preserved_rows,
            rows[header_start:header_end],  # 表头行（保留原样）
            filled_data_rows,
        )

        return rows_filled

    # ============================================================
    # 表头识别
    # ============================================================

    def _find_header_end(
        self, rows: list[etree._Element], start: int
    ) -> int:
        """智能识别表头区域结束位置

        表头特征：
          - vMerge continue 的行
          - gridSpan > 1 且单元格数少的行
          - 被 analyze_row_cells 判定为 header_row 的行
        """
        if start >= len(rows):
            return start

        # 第一行数据行作为参考
        ref_cells = len(row_cells(rows[start]))

        for i in range(start, len(rows)):
            analysis = analyze_row_cells(rows[i])
            cells = row_cells(rows[i])

            # 签名行 → 表头结束
            if analysis.is_signature_row:
                return i

            # vMerge continue 或 gridSpan 异常 → 可能是表头
            has_vmerge = any(cell_vmerge_status(c) == "continue" for c in cells)
            has_large_span = any(cell_gridspan(c) > 1 for c in cells)

            if has_vmerge or (has_large_span and len(cells) < ref_cells):
                continue  # 仍在表头区域

            # 表头特征：多数单元格有内容
            if analysis.is_header_row:
                continue

            # 遇到数据行 → 表头结束于此
            return i

        # 防止所有行被识别为表头
        return min(start + 1, len(rows) - 1)

    # ============================================================
    # 数据行填充（样式保留）
    # ============================================================

    def _fill_row_with_data(
        self,
        row: etree._Element,
        headers: list[str],
        data: dict[str, str],
    ) -> etree._Element:
        """用数据填充一行 — 对应 TS fillRowWithData

        核心原则：只替换 <w:t> 文本，完全保留模板格式。
        Handles gridSpan (跳过重复物理单元格) 和 vMerge continue.

        Args:
            row: <w:tr> 模板行 Element
            headers: 列名列表
            data: 列名→值的映射

        Returns:
            填充后的行 Element（原地修改）
        """
        cells = row_cells(row)

        # 构建逻辑列 → 物理单元格映射
        logical_to_physical: list[int] = []
        processed_phys: set[int] = set()

        logical_col = 0
        for phys_idx, cell in enumerate(cells):
            if is_vmerge_continue(cell):
                continue  # vMerge continue 不分配逻辑列
            span = cell_gridspan(cell)
            for _ in range(span):
                logical_to_physical.append(phys_idx)
            logical_col += span

        # 从后往前替换（避免索引偏移）
        data_keys = list(data.keys())
        num_cols = min(len(headers), len(logical_to_physical))

        for logical_i in range(num_cols - 1, -1, -1):
            phys_idx = logical_to_physical[logical_i]
            if phys_idx in processed_phys:
                continue  # gridSpan > 1 的去重
            processed_phys.add(phys_idx)

            header = headers[logical_i] if logical_i < len(headers) else ""
            value = data.get(header, "")

            if value and phys_idx < len(cells):
                inject_text_into_cell(cells[phys_idx], str(value))

        return row

    # ============================================================
    # KV 表格填充
    # ============================================================

    def fill_key_value_table(
        self,
        tree: etree._Element,
        target_table_index: int,
        kv_data: dict[str, str],
    ) -> int:
        """填充纯 KV 表格 — 对应 TS fillKeyValueTable

        Args:
            tree: document.xml ElementTree
            target_table_index: 目标表格索引
            kv_data: key → value 映射

        Returns:
            填充的单元格数
        """
        tables = all_tables(tree)
        if target_table_index >= len(tables):
            return 0

        target_table = tables[target_table_index]
        rows = table_rows(target_table)
        cells_filled = 0

        for row in rows:
            cells_filled += self._fill_kv_row(row, kv_data)

        return cells_filled

    def _fill_kv_row(
        self, row: etree._Element, kv_data: dict[str, str]
    ) -> int:
        """填充单行 KV 数据 — 对应 TS fillKeyValueRow

        从后往前扫描单元格对，匹配标签 → 填充值。
        """
        cells = row_cells(row)
        filled = 0

        # 获得所有单元格文本
        cell_texts_list = [cell_merged_text(c) for c in cells]

        # 从后往前扫描配对
        for i in range(len(cell_texts_list) - 1, 0, -2):
            label_text = cell_texts_list[i - 1] if i - 1 >= 0 else ""
            value_text = cell_texts_list[i] if i < len(cell_texts_list) else ""

            # 只关心标签在 kv_data 中且值格为空的配对
            if label_text in kv_data:
                if not value_text or value_text.isspace():
                    inject_text_into_cell(cells[i], str(kv_data[label_text]))
                    filled += 1

        return filled

    # ============================================================
    # 签名行填充
    # ============================================================

    def _fill_signature_row_direct(
        self, row: etree._Element, sig: SignatureBlock
    ) -> etree._Element:
        """直接填充签名行 — 对应 TS fillSignatureRowDirect

        识别锚点（检测/校对/审核关键词）并填写姓名和日期。

        Args:
            row: <w:tr> 签名行 Element
            sig: 签名数据

        Returns:
            填充后的行 Element
        """
        cells = row_cells(row)

        for cell_idx in range(len(cells) - 1, -1, -1):
            cell = cells[cell_idx]
            all_text = cell_merged_text(cell)
            wts = cell.findall(".//w:t", NSMAP)

            if not wts:
                continue

            # 确定角色
            role = self._detect_sig_role(all_text)
            if not role:
                continue

            name = ""
            date = ""
            if role == "inspector":
                name = sig.inspector_name
                date = sig.inspector_date
            elif role == "checker":
                name = sig.checker_name
                date = sig.checker_date
            elif role == "reviewer":
                name = sig.reviewer_name
                date = sig.reviewer_date

            # 策略 1：锚点在同一 <w:t> 内 → 锚点后插入姓名
            self._try_insert_name_inline(wts, name)

            # 策略 2：锚点跨 run → 在适当位置插入
            self._try_insert_name_cross_run(wts, name)

            # 日期替换
            if date:
                self._replace_multi_run_date(cell, date)

        return row

    def _detect_sig_role(self, text: str) -> Optional[str]:
        """从文本中检测签名角色"""
        if re.search(r"检测|检查", text):
            return "inspector"
        if re.search(r"校对", text):
            return "checker"
        if re.search(r"审核|审批", text):
            return "reviewer"
        return None

    def _try_insert_name_inline(
        self, wts: list[etree._Element], name: str
    ) -> bool:
        """策略1: 锚点在同一 run 内 → 直接插入姓名"""
        if not name or not wts:
            return False

        # 找到含 "检测：" 或 "校对：" 等的 run
        for wt in wts:
            text = (wt.text or "") if wt.text else ""
            if re.search(r"(检测|校对|审核|审批)[：:]", text):
                # 在冒号后插入姓名
                wt.text = re.sub(
                    r"((检测|校对|审核|审批)[：:])\s*",
                    rf"\1{name}  ",
                    text,
                )
                return True

        return False

    def _try_insert_name_cross_run(
        self, wts: list[etree._Element], name: str
    ) -> bool:
        """策略2: 锚点跨 run（如"检测"在一个run，"："在下一个）"""
        if not name or len(wts) < 2:
            return False

        for i in range(len(wts) - 1):
            t1 = (wts[i].text or "").strip()
            t2 = (wts[i + 1].text or "").strip()

            if t1 in ("检测", "校对", "审核", "审批") and t2 == "：" or t2 == ":":
                # 在冒号所在 run 前插入姓名
                wts[i + 1].text = f"{name}  {t2}"
                return True

        return False

    # ============================================================
    # 多 run 日期替换
    # ============================================================

    def _replace_multi_run_date(
        self, cell: etree._Element, date: str
    ) -> None:
        """替换跨多个 <w:t> 的日期占位符 — 对应 TS replaceMultiRunDate

        处理 WPS 常见拆分格式：
        <w:t>202</w:t><w:t>X</w:t><w:t>年</w:t><w:t>X</w:t><w:t>月</w:t><w:t>XX</w:t><w:t>日</w:t>
        """
        wts = cell.findall(".//w:t", NSMAP)
        if len(wts) < 2:
            return

        n = len(wts)
        for start in range(n):
            text = (wts[start].text or "").strip()

            # 查找日期序列起点（含"20"和占位符）
            if not (text and "20" in text and ("X" in text.upper() or text.replace("20", "").isdigit())):
                continue

            # 向后查找终点（含"日"）
            end = -1
            date_texts = [text]
            for j in range(start + 1, min(start + 10, n)):
                t = (wts[j].text or "").strip()
                date_texts.append(t)
                if "日" in t:
                    end = j
                    break

            if end >= 0:
                # 验证中间片段是否都是日期相关的
                mid_texts = date_texts[1:-1]
                if all(self._is_date_fragment(t) for t in mid_texts):
                    # 整体替换：保留第一个 <w:t> 放完整日期，清空其余
                    wts[start].text = date
                    for k in range(start + 1, end + 1):
                        wts[k].text = ""
                    return

    def _is_date_fragment(self, text: str) -> bool:
        """判断文本是否为日期片段（年/月/数字/X占位符/空格）"""
        if not text:
            return False
        return bool(re.match(r"^[\d\sX年月日\-\/]*$", text, re.IGNORECASE))

    # ============================================================
    # 行替换辅助
    # ============================================================

    def _replace_rows(
        self,
        table: etree._Element,
        preserved: list[etree._Element],
        header_rows_list: list[etree._Element],
        filled_rows: list[etree._Element],
    ) -> None:
        """替换表格中的行：清除旧行 + 按顺序插入新行"""
        # 清除所有旧行
        for row in table_rows(table):
            table.remove(row)

        # 插入保留行（KV行）
        for row in preserved:
            table.append(row)

        # 插入表头行
        for row in header_rows_list:
            table.append(row)

        # 插入填充后的数据行 + 签名行
        for row in filled_rows:
            table.append(row)
