"""
XML 子树插入引擎 — 对应 TS xml-subtree-inserter.service.ts

将数据行的文本填入模板表格行，保留所有原始样式。
核心原则：只操作 <w:t> 文本内容，不动结构、属性、样式。

用 lxml Element API 替代所有字符串操作，但逻辑完全对齐 TS 版。
"""

from __future__ import annotations

import copy
import logging
import re
from typing import Optional

from lxml import etree

from report_filler.models import SignatureBlock, get_validation_text, is_cell_valid
from report_filler.xml_utils import (
    qn,
    NSMAP,
    WORDML_NS,
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

logger = logging.getLogger(__name__)


def _get_all_wt_text(cell: etree._Element) -> str:
    """提取单元格中所有 <w:t> 文本拼接 — 对应 TS getAllWtText"""
    return cell_merged_text(cell)


def _extract_cell_texts(row: etree._Element) -> list[str]:
    """提取行中每个 <w:tc> 的合并文本 — 对应 TS extractCellTexts"""
    return [cell_merged_text(c) for c in row_cells(row)]


def _extract_all_rows(table: etree._Element) -> list[dict]:
    """提取表格中所有行 — 对应 TS extractAllRows
    Returns: [{"element": <w:tr>, "is_empty": bool}, ...]
    """
    result = []
    for row in table_rows(table):
        texts = [cell_merged_text(c) for c in row_cells(row)]
        all_empty = all(not t or t.isspace() for t in texts)
        result.append({"element": row, "is_empty": all_empty})
    return result


def _get_table_wrapper(table: etree._Element) -> dict:
    """提取表格的非行部分 — 对应 TS getTableWrapper
    返回 {"prefix": Element, "prefix_after": <w:tblGrid>后面的元素, ...}
    简化版：用字符串方式处理
    """
    return {}  # lxml 版本不需要，直接用 Element 操作


def _clean_vmerge_from_row(row: etree._Element) -> etree._Element:
    """清除克隆行中的 vMerge restart 属性 — 对应 TS cleanVMergeFromRow"""
    cloned = clone_table_row(row)
    for tc in row_cells(cloned):
        tc_pr = tc.find(qn("w:tcPr"))
        if tc_pr is not None:
            vmerge = tc_pr.find(qn("w:vMerge"))
            if vmerge is not None:
                val = vmerge.get(qn("w:val"))
                if val == "restart":
                    tc_pr.remove(vmerge)
    return cloned


def _has_vmerge(row: etree._Element) -> bool:
    """检测行是否含 vMerge"""
    for tc in row_cells(row):
        tc_pr = tc.find(qn("w:tcPr"))
        if tc_pr is not None and tc_pr.find(qn("w:vMerge")) is not None:
            return True
    return False


def _has_gridspan(row: etree._Element) -> bool:
    """检测行是否含 gridSpan"""
    for tc in row_cells(row):
        tc_pr = tc.find(qn("w:tcPr"))
        if tc_pr is not None and tc_pr.find(qn("w:gridSpan")) is not None:
            return True
    return False


def _cell_count(row: etree._Element) -> int:
    """统计行中物理单元格数"""
    return len(row_cells(row))


# ============================================================
# 主类：XmlSubtreeInserter
# ============================================================


class XmlSubtreeInserter:
    """XML 子树插入引擎 — 对应 TS XmlSubtreeInserter"""

    # ----------------------------------------------------------
    # fill_table_from_source — 对应 TS fillTableFromSource
    # ----------------------------------------------------------

    def fill_table_from_source(
        self,
        tree: etree._Element,
        target_table_index: int,
        source_table: dict,
        data_start_row: int = 0,
        signature_block: Optional[SignatureBlock] = None,
        valid_grid: Optional[list[list[bool]]] = None,
    ) -> int:
        """将源数据填入目标表格 — 对应 TS fillTableFromSource

        Args:
            tree: document.xml 根节点
            target_table_index: 目标表格索引（从 0 开始）
            source_table: {"headers": [...], "rows": [{...}, ...]}
            data_start_row: 保留行数（混合表中 KV 行数）
            signature_block: 签名数据块
            valid_grid: 每行每列的校验状态，valid_grid[i][j] = True 表示校验通过

        Returns:
            填充的数据行数
        """
        tables = all_tables(tree)
        if target_table_index >= len(tables):
            logger.warning(
                "表格索引 %d 超出范围 (共 %d 个表格)，已跳过",
                target_table_index, len(tables)
            )
            return 0

        target_table = tables[target_table_index]

        # 2. 提取源数据行（与 TS extractTableDataRows 对齐）
        data_headers = source_table.get("headers", [])
        data_rows = source_table.get("rows", [])
        if not data_rows:
            # 无数据行但有签名数据时，仍需处理签名行
            if signature_block and (
                signature_block.inspector_name or signature_block.inspector_date
                or signature_block.checker_name or signature_block.checker_date
                or signature_block.reviewer_name or signature_block.reviewer_date
            ):
                logger.info("源表格无数据行，但签名数据存在，继续处理签名行")
            else:
                logger.info("源表格无数据行，跳过填充")
                return 0

        # 3. 提取模板所有行 — 对应 TS extractAllRows
        target_rows = _extract_all_rows(target_table)

        if len(target_rows) < 3:
            logger.warn("模板表格行数不足（需≥3行），无法填充")
            return 0

        # 4. 智能识别表头区域 — 完全对齐 TS 版 headerEndIndex 逻辑
        # 收集 dataStartRow 之前的行作为保留区（KV 行）
        preserved_rows: list[etree._Element] = []
        for i in range(min(data_start_row, len(target_rows))):
            preserved_rows.append(target_rows[i]["element"])

        header_rows: list[etree._Element] = []
        header_end_index = data_start_row

        for i in range(data_start_row, len(target_rows) - 1):
            row_elem = target_rows[i]["element"]
            has_vmerge = _has_vmerge(row_elem)
            has_gs = _has_gridspan(row_elem)
            cell_cnt = _cell_count(row_elem)

            first_header_cell_count = (
                _cell_count(header_rows[0]) if header_rows else cell_cnt
            )

            # 起始行总是表头
            # 后续行属于表头: a) 含 vMerge b) 含 gridSpan 且单元格数 ≤ 首行
            is_merge_title_row = has_gs and cell_cnt <= first_header_cell_count

            if i == data_start_row or has_vmerge or is_merge_title_row:
                header_rows.append(row_elem)
                header_end_index = i + 1
            else:
                break

        # 多层表头扩展 — 对齐 TS 版 while 循环
        while header_end_index < len(target_rows) - 1 and header_rows:
            last_header_cell_cnt = _cell_count(header_rows[-1])
            next_elem = target_rows[header_end_index]["element"]
            next_cell_cnt = _cell_count(next_elem)
            next_has_vmerge = _has_vmerge(next_elem)

            if next_cell_cnt >= 3 and next_cell_cnt > last_header_cell_cnt:
                header_rows.append(next_elem)
                header_end_index += 1
            elif next_has_vmerge:
                header_rows.append(next_elem)
                header_end_index += 1
            else:
                break

        # 如果所有非签名行都是表头（异常），至少保留起始行
        if header_end_index >= len(target_rows) - 1:
            header_end_index = data_start_row + 1
            header_rows = [target_rows[data_start_row]["element"]]

        # 签名行检测 — 对齐 TS 版 hasSignatureRow
        last_row_elem = target_rows[-1]["element"]
        last_row_texts = _get_all_wt_text(last_row_elem)
        has_signature_row = bool(
            re.search(r"检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]", last_row_texts)
        )
        signature_template = last_row_elem if has_signature_row else None

        # 模板数据行（表头之后 ~ 签名行之前）
        if has_signature_row:
            template_data_rows = [
                target_rows[i]["element"]
                for i in range(header_end_index, len(target_rows) - 1)
            ]
        else:
            template_data_rows = [
                target_rows[i]["element"]
                for i in range(header_end_index, len(target_rows))
            ]

        # 过滤结论行 — 对齐 TS 版 preservedAfterData 逻辑
        preserved_after_data: list[etree._Element] = []
        filtered_template_rows: list[etree._Element] = []
        for row_elem in template_data_rows:
            cell_cnt = _cell_count(row_elem)
            if cell_cnt <= 2:
                # 计算总 gridSpan
                total_gs = 0
                gs_count = 0
                for tc in row_cells(row_elem):
                    gs = cell_gridspan(tc)
                    total_gs += gs
                    if gs > 1:
                        gs_count += 1
                if total_gs >= 6:
                    preserved_after_data.append(row_elem)
                    continue
            filtered_template_rows.append(row_elem)

        template_data_rows = filtered_template_rows

        logger.info(
            "表格行结构: %d行, 保留%d行, 表头%d行, 数据模板%d行, 结论行%d行, 签名%d行",
            len(target_rows), len(preserved_rows), len(header_rows),
            len(template_data_rows), len(preserved_after_data),
            1 if has_signature_row else 0,
        )

        # 5. 填充数据行 — 完全对齐 TS 版 for 循环
        filled_data_rows: list[etree._Element] = []
        rows_filled = 0

        template_row = template_data_rows[0] if template_data_rows else None
        # 保存原始模板行的深拷贝，避免后续克隆时使用已被原地修改污染的行
        pristine_template_row = copy.deepcopy(template_row) if template_row is not None else None

        for i in range(max(len(template_data_rows), len(data_rows))):
            row_valid_flags = valid_grid[i] if valid_grid and i < len(valid_grid) else None
            if i < len(data_rows) and i < len(template_data_rows):
                # 源有数据 + 模板有空行 → 填入
                filled = self._fill_row_with_data(
                    template_data_rows[i], data_headers, data_rows[i],
                    valid_flags=row_valid_flags,
                )
                filled_data_rows.append(filled)
                rows_filled += 1
            elif i < len(template_data_rows):
                # 源无更多数据 → 保留模板空行原样
                filled_data_rows.append(template_data_rows[i])
            else:
                # 源数据超出模板行数 → 克隆原始模板第一行（深拷贝，避免已被填充污染）
                if pristine_template_row is None:
                    break
                cloned = _clean_vmerge_from_row(pristine_template_row)
                filled = self._fill_row_with_data(cloned, data_headers, data_rows[i],
                    valid_flags=row_valid_flags)
                filled_data_rows.append(filled)
                rows_filled += 1

        # 6. 填充签名行 — 对齐 TS 版签名行逻辑
        filled_signature: Optional[etree._Element] = None
        if has_signature_row and signature_template is not None:
            if signature_block and (
                signature_block.inspector_name
                or signature_block.inspector_date
                or signature_block.checker_name
                or signature_block.checker_date
                or signature_block.reviewer_name
                or signature_block.reviewer_date
            ):
                filled_signature = self._fill_signature_row_direct(
                    signature_template, signature_block
                )
            else:
                filled_signature = signature_template

        # 7. 组装表格 — 对齐 TS 版 rebuiltTbl
        # 清除旧行
        for row in table_rows(target_table):
            target_table.remove(row)

        # 按顺序插入
        for row in preserved_rows:
            target_table.append(row)
        for row in header_rows:
            target_table.append(row)
        for row in filled_data_rows:
            target_table.append(row)
        for row in preserved_after_data:
            target_table.append(row)
        if filled_signature is not None:
            target_table.append(filled_signature)

        return rows_filled

    # ----------------------------------------------------------
    # _fill_row_with_data — 对应 TS fillRowWithData
    # ----------------------------------------------------------

    def _fill_row_with_data(
        self,
        row: etree._Element,
        headers: list[str],
        data: dict,
        valid_flags: Optional[list[bool]] = None,
    ) -> etree._Element:
        """用数据填充一行 — 对应 TS fillRowWithData

        核心原则：只替换 <w:t> 文本，完全保留模板格式。
        处理 vMerge continue 和 gridSpan 映射。
        支持复合 value 格式 {value, valid, reason}，校验未通过的单元格黄色高亮。
        """
        cells = row_cells(row)

        # 构建逻辑列 → 物理单元格映射（跳过 vMerge continue）
        logical_to_physical: list[int] = []
        processed_phys: set[int] = set()

        for phys_idx, cell in enumerate(cells):
            if is_vmerge_continue(cell):
                continue  # vMerge continue 不分配逻辑列
            span = cell_gridspan(cell)
            for _ in range(span):
                logical_to_physical.append(phys_idx)

        # 数据格式检测
        num_cols = min(len(headers), len(logical_to_physical))
        data_keys = list(data.keys())

        # 紧凑格式：data.length < logicalCol
        if data_keys and len(data_keys) < len(logical_to_physical):
            # 紧凑格式：从后往前填
            logger.debug(
                "[紧凑格式] row=%s logicalCols=%d dataKeys=%d validFlags=%s",
                data.get("序号", "?"), len(logical_to_physical),
                len(data_keys),
                valid_flags if valid_flags else "None",
            )
            fillable_count = sum(
                1 for c in cells if not is_vmerge_continue(c)
            )
            padded_data = list(data_keys)
            if len(padded_data) < fillable_count:
                padded_data.extend([""] * (fillable_count - len(padded_data)))

            data_idx = len(padded_data) - 1
            for phys_idx in range(len(cells) - 1, -1, -1):
                if data_idx < 0:
                    break
                if is_vmerge_continue(cells[phys_idx]):
                    continue
                header = padded_data[data_idx] if data_idx < len(padded_data) else ""
                current_data_idx = data_idx
                data_idx -= 1
                if not header:
                    continue
                if phys_idx in processed_phys:
                    continue
                raw_value = data.get(header, "")
                value = get_validation_text(raw_value)
                if value:
                    is_invalid = False
                    if valid_flags and current_data_idx < len(valid_flags):
                        is_invalid = not valid_flags[current_data_idx]
                    elif not is_cell_valid(raw_value):
                        is_invalid = True
                    logger.debug(
                        "  [紧凑] physIdx=%d dataIdx=%d header=%s value=%s valid=%s highlight=%s",
                        phys_idx, current_data_idx, header, str(value),
                        is_cell_valid(raw_value), is_invalid,
                    )
                    inject_text_into_cell(cells[phys_idx], str(value), highlight=is_invalid)
                processed_phys.add(phys_idx)
        else:
            # 展开格式：data[li] 对应逻辑列 li
            logger.debug(
                "[展开格式] row=%s logicalCols=%d headers=%d validFlags=%s",
                data.get("序号", "?"), len(logical_to_physical),
                len(headers),
                valid_flags if valid_flags else "None",
            )
            for li in range(len(logical_to_physical) - 1, -1, -1):
                if li >= len(headers):
                    continue
                header = headers[li]
                raw_value = data.get(header, "")
                value = get_validation_text(raw_value)
                if not value:
                    continue
                phys_idx = logical_to_physical[li]
                if phys_idx >= len(cells):
                    continue
                if phys_idx in processed_phys:
                    continue
                is_invalid = False
                if valid_flags and li < len(valid_flags):
                    is_invalid = not valid_flags[li]
                elif not is_cell_valid(raw_value):
                    is_invalid = True
                logger.debug(
                    "  [展开] physIdx=%d li=%d header=%s value=%s valid=%s highlight=%s",
                    phys_idx, li, header, str(value),
                    is_cell_valid(raw_value), is_invalid,
                )
                inject_text_into_cell(cells[phys_idx], str(value), highlight=is_invalid)
                processed_phys.add(phys_idx)

        return row

    # ----------------------------------------------------------
    # fill_key_value_table — 对应 TS fillKeyValueTable
    # ----------------------------------------------------------

    def fill_key_value_table(
        self,
        tree: etree._Element,
        target_table_index: int,
        kv_data: dict[str, str],
    ) -> int:
        """填充纯 KV 表格 — 对应 TS fillKeyValueTable

        遍历模板表格每一行，查找标签 Key → 填充对应空单元格。

        Returns:
            填充的单元格数
        """
        tables = all_tables(tree)
        if target_table_index >= len(tables):
            return 0

        target_table = tables[target_table_index]
        cells_filled = 0

        for row in table_rows(target_table):
            filled = self._fill_key_value_row(row, kv_data)
            cells_filled += filled

        return cells_filled

    def _fill_key_value_row(
        self,
        row: etree._Element,
        kv_data: dict[str, str],
    ) -> int:
        """填充单行 KV 数据 — 对应 TS fillKeyValueRow

        动态扫描：从后往前，逐位查找已知 Key → 填充相邻空单元格。
        自动适应合并单元格导致的配对偏移。
        支持复合 value 格式 {value, valid, reason}。
        """
        cells = row_cells(row)
        cell_texts_list = [cell_merged_text(c) for c in cells]
        filled = 0

        # 从后往前扫描（避免索引偏移）
        for i in range(len(cells) - 2, -1, -1):
            label_text = cell_texts_list[i] if i < len(cell_texts_list) else ""
            if not label_text:
                continue

            # 在源数据中查找
            raw_value = kv_data.get(label_text)
            if not raw_value:
                continue

            # 提取纯文本值
            value = get_validation_text(raw_value)
            if not value:
                continue

            # 检查值单元格是否为空（只填充空单元格）
            value_text = cell_texts_list[i + 1] if (i + 1) < len(cell_texts_list) else ""
            if value_text and not value_text.isspace():
                continue  # 已有非空内容，跳过

            # 判断是否需要高亮
            is_invalid = not is_cell_valid(raw_value)

            # 填充
            inject_text_into_cell(cells[i + 1], str(value), highlight=is_invalid)
            filled += 1

        return filled

    # ----------------------------------------------------------
    # 签名行填充 — 对应 TS fillSignatureRowDirect
    # ----------------------------------------------------------

    def _fill_signature_row_direct(
        self,
        row: etree._Element,
        sig: SignatureBlock,
    ) -> etree._Element:
        """直接用 SignatureBlock 填充签名行 — 对应 TS fillSignatureRowDirect

        策略：在模板的"检测：""校对：""审核："锚点后插入姓名，替换日期占位符。
        """
        cells = row_cells(row)

        for cell in cells:
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
                name = sig.inspector_name or ""
                date = sig.inspector_date or ""
            elif role == "checker":
                name = sig.checker_name or ""
                date = sig.checker_date or ""
            elif role == "reviewer":
                name = sig.reviewer_name or ""
                date = sig.reviewer_date or ""

            # 1. 插入姓名（策略1 + 策略2）
            if name and name.strip():
                self._try_insert_name_inline(wts, name)
                self._try_insert_name_cross_run(wts, name)

            # 2. 替换日期
            if date and date.strip():
                self._replace_multi_run_date(cell, date)

        return row

    def _detect_sig_role(self, text: str) -> Optional[str]:
        """检测签名角色"""
        if re.search(r"检测[：:]|检查[：:]", text):
            return "inspector"
        if re.search(r"校对[：:]", text):
            return "checker"
        if re.search(r"审核[：:]|审批[：:]", text):
            return "reviewer"
        return None

    def _try_insert_name_inline(
        self, wts: list[etree._Element], name: str
    ) -> bool:
        """策略1: 锚点在同一 run 内 → 锚点后直接插入姓名"""
        if not name or not wts:
            return False

        for wt in wts:
            text = (wt.text or "") if wt.text else ""
            # 匹配 "检测：" 或 "检测:" 等
            m = re.search(r"(检测|校对|审核|审批|检查)[：:]", text)
            if m:
                end_pos = m.end()
                # 检查锚点后是否已有姓名（防止重复填充）
                after = text[end_pos:] if end_pos < len(text) else ""
                if after and not re.match(r"^[\s\dX年月日\-/]*$", after):
                    # 锚点后已有非日期内容（如已填充的姓名），跳过
                    return True
                # 在锚点后插入姓名
                wt.text = text[:end_pos] + name + text[end_pos:]
                return True

        return False

    def _try_insert_name_cross_run(
        self, wts: list[etree._Element], name: str
    ) -> bool:
        """策略2: 锚点跨 run"""
        if not name or len(wts) < 2:
            return False

        for i in range(len(wts) - 1):
            t1 = (wts[i].text or "").strip()
            t2 = (wts[i + 1].text or "").strip()

            if t1 in ("检测", "校对", "审核", "审批", "检查") and t2 in ("：", ":"):
                # 冒号后插入姓名 — 对齐 TS: escapedColon + role.name
                wts[i + 1].text = t2 + name
                return True

        return False

    # ----------------------------------------------------------
    # 多 run 日期替换 — 对应 TS replaceMultiRunDate
    # ----------------------------------------------------------

    def _replace_multi_run_date(
        self, cell: etree._Element, date: str
    ) -> None:
        """替换跨多个 <w:t> 的日期占位符 — 对应 TS replaceMultiRunDate"""
        wts = cell.findall(".//w:t", NSMAP)
        if len(wts) < 2:
            # 单run日期
            if wts:
                text = wts[0].text or ""
                for pat in [
                    r"20\dX年\d{1,2}月\d{1,2}日",
                    r"20\dX年X月XX日",
                    r"20XX年XX月XX日",
                ]:
                    if re.search(pat, text):
                        wts[0].text = re.sub(pat, date, text)
                        return
            return

        n = len(wts)
        for start in range(n):
            text = (wts[start].text or "").strip()
            # 起始条件：以 2 开头，含 X 或纯数字日期
            is_date_start = (
                text
                and text.startswith("2")
                and (
                    "X" in text.upper()
                    or text.isdigit()
                    or bool(re.match(r"^2[X\d]*[年月]", text))
                )
            )
            if not is_date_start:
                continue

            # 向后查找 "日"
            for j in range(start, min(start + 10, n)):
                t = (wts[j].text or "").strip()
                if t.endswith("日") or t == "日":
                    # 验证中间是否都是日期片段
                    all_date = True
                    for k in range(start, j + 1):
                        tk = (wts[k].text or "").strip()
                        if not re.match(r"^[\s\dX年月日]*$", tk):
                            all_date = False
                            break
                    if all_date:
                        wts[start].text = date
                        for k in range(start + 1, j + 1):
                            wts[k].text = ""
                        return
                    break

    # ----------------------------------------------------------
    # fill_table_signature — 对应 TS fillTableSignature
    # ----------------------------------------------------------

    def fill_table_signature(
        self,
        tree: etree._Element,
        target_table_index: int,
        sig: SignatureBlock,
    ) -> bool:
        """填充指定表格的签名行 — 对应 TS fillTableSignature

        Returns:
            是否成功填充
        """
        tables = all_tables(tree)
        if target_table_index >= len(tables):
            return False

        target_table = tables[target_table_index]
        target_rows = _extract_all_rows(target_table)
        if not target_rows:
            return False

        # 检查最后一行是否为签名行
        last_row = target_rows[-1]["element"]
        last_row_texts = _get_all_wt_text(last_row)
        has_signature = bool(
            re.search(r"检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]", last_row_texts)
        )

        if not has_signature:
            logger.info("表格[%d]: 末行无签名关键词，跳过签名填充", target_table_index)
            return False

        # 填充签名行
        self._fill_signature_row_direct(last_row, sig)
        logger.info("表格[%d]签名行填充成功", target_table_index)
        return True


# Re-export for convenience
from report_filler.xml_utils import RowAnalysis  # noqa: E402
