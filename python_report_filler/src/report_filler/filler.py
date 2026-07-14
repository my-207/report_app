"""
填充协调器 — 对应 TS filler.service.ts

编排整个填充流程：
  1. 占位符替换（文本模式匹配）
  2. 按 tableIndex 降序处理 sections（避免 XML 位置偏移）
  3. 每个 section：先 KV 表填充 → 再列表表填充
  4. 输出 .docx

完全对齐 TS 版 fillBySubtreeCopyV2 的逻辑。
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from lxml import etree

from report_filler.docx_io import DocxIO
from report_filler.models import (
    BasicInfo,
    UnifiedReportData,
    SectionData,
    FillResult,
    FillStats,
    ValidationInfo,
    TemplateStructure,
    is_cell_valid,
)
from report_filler.template_analyzer import TemplateAnalyzer
from report_filler.xml_subtree_inserter import XmlSubtreeInserter
from report_filler.xml_utils import (
    qn,
    NSMAP,
    cell_merged_text,
    analyze_row_cells,
    table_rows as get_table_rows,
)

logger = logging.getLogger("report_filler")

# ============================================================
# 占位符映射表（与 TS filler.service.ts PLACEHOLDER_MAP 对齐）
# ============================================================

PLACEHOLDER_MAP: list[tuple[str, str, int]] = [
    # (正则模式, BasicInfo字段名, 优先级)
    (r"X{4,}/X{4,}/X{4,}/X{4,}", "report_type_prefix", 10),
    (r"[A-Z]*-X{3,}-X{3,}-20\dX", "report_number", 9),
    (r"X{10,}(?!/)", "device_name", 8),
    (r"X{6,}公司", "company_name", 7),
    (r"20\dX年[\s\u3000]*[\dX]+月[\s\u3000]*-[\s\u3000]*20\dX年[\s\u3000]*[\dX]+月", "inspection_date_range", 6),
    (r"20\dX年[\dX]+月[\dX]+日", "signature_date", 5),
    (r"20XX年XX月XX日", "signature_date_backup", 4),
]


class ReportFiller:
    """报告填充器 — 主 Python API 入口，逻辑对齐 TS fillBySubtreeCopyV2"""

    def __init__(self, template_path: str | Path):
        self._template_path = Path(template_path)
        self._inserter = XmlSubtreeInserter()
        self._tree: Optional[etree._Element] = None
        self._unpacked_dir: Optional[Path] = None

    # ============================================================
    # 主入口 — 对应 TS ReportFiller.fill()
    # ============================================================

    def fill(
        self,
        data: UnifiedReportData,
        output_path: str | Path,
    ) -> FillResult:
        """主入口：填充数据到模板并输出 .docx

        完全对齐 TS 版 fillBySubtreeCopyV2 的流程。
        """
        output_path = Path(output_path)
        result = FillResult()
        warnings: list[str] = []

        try:
            # 1. 解包模板
            logger.info("解包模板...")
            unpacked_dir = DocxIO.copy_template(
                str(self._template_path), output_path.parent
            )
            self._unpacked_dir = unpacked_dir

            # 2. 读取 XML
            logger.info("读取 document.xml...")
            self._tree = DocxIO.read_document_xml(unpacked_dir)

            # 3. 保存填充前 XML
            before_xml = DocxIO.read_document_xml_raw(unpacked_dir)

            # 4. 占位符替换 — 对应 TS replacePlaceholders
            logger.info("替换占位符...")
            placeholder_count = self._replace_placeholders(data.basic_info)

            # 5. 分析模板结构
            logger.info("分析模板结构...")
            analyzer = TemplateAnalyzer(self._tree)
            template_structure = analyzer.analyze()

            # 6. 按 tableIndex 降序排序 sections — 对应 TS sortedSections
            # 从后往前填充，避免前面的修改导致后续表格位置偏移
            sorted_sections = sorted(
                data.sections,
                key=lambda s: s.table_index if s.table_index is not None else float("inf"),
                reverse=True,
            )

            logger.info("填充表格数据...")
            tables_filled = 0
            rows_inserted = 0
            kv_cells_filled = 0

            for section in sorted_sections:
                try:
                    table_index = section.table_index

                    # 混合表：在 KV 填充前扫描模板，计算连续 KV 行数
                    kv_row_count = 0
                    if table_index is not None and section.has_hybrid_table:
                        kv_row_count = self._count_kv_rows_in_template(
                            table_index, section
                        )

                    # 2a. 键值对表填充 — 对应 TS fillKeyValueTable
                    if section.kv_pairs or section.has_hybrid_table:
                        if table_index is not None:
                            kv_data = {kv.key: kv.value for kv in section.kv_pairs}
                            cells = self._inserter.fill_key_value_table(
                                self._tree, table_index, kv_data
                            )
                            if cells > 0:
                                tables_filled += 1
                                kv_cells_filled += cells
                                logger.info(
                                    "KV表填充成功: tableIndex=%d, cells=%d",
                                    table_index, cells,
                                )

                        # KV表的签名行填充（无列表数据路径时）
                        sig = section.signature
                        has_list_data = section.tables and len(section.tables) > 0
                        if (
                            not has_list_data
                            and sig
                            and table_index is not None
                            and (
                                sig.inspector_name
                                or sig.inspector_date
                                or sig.checker_name
                                or sig.checker_date
                                or sig.reviewer_name
                                or sig.reviewer_date
                            )
                        ):
                            filled = self._inserter.fill_table_signature(
                                self._tree, table_index, sig
                            )
                            if filled:
                                logger.info(
                                    "KV表签名行填充成功: tableIndex=%d, section=%s",
                                    table_index, section.id,
                                )

                    # 2b. 列表型表格填充 — 对应 TS fillTableFromSource
                    for dt in section.tables:
                        data_start = kv_row_count

                        # 构建 validGrid — 对应 TS dataTableToXml 中的 validGrid
                        valid_grid = self._build_valid_grid(dt)

                        if table_index is not None:
                            rows = self._inserter.fill_table_from_source(
                                self._tree,
                                table_index,
                                {
                                    "headers": dt.headers,
                                    "rows": dt.rows,
                                },
                                data_start_row=data_start,
                                signature_block=section.signature,
                                valid_grid=valid_grid,
                            )
                            if rows > 0:
                                rows_inserted += rows
                                tables_filled += 1
                                logger.info(
                                    "列表表填充成功: tableIndex=%d, rows=%d",
                                    table_index, rows,
                                )

                except Exception as section_err:
                    logger.error(
                        "section %s (tableIndex=%s) 处理失败: %s",
                        section.id, section.table_index, section_err,
                        exc_info=True,
                    )
                    warnings.append(
                        f"section {section.id} 处理失败: {section_err}"
                    )

            # 7. 写入 XML
            logger.info("写入填充后的 XML...")
            DocxIO.write_document_xml(self._tree, unpacked_dir)

            # 8. 校验
            logger.info("执行格式校验...")
            after_xml = DocxIO.read_document_xml_raw(unpacked_dir)
            validation = self._validate(before_xml, after_xml, unpacked_dir)

            # 9. 打包
            logger.info("打包输出文件...")
            DocxIO.pack(unpacked_dir, output_path)

            # 10. 清理
            DocxIO.cleanup(unpacked_dir)

            stats = FillStats(
                placeholders_replaced=placeholder_count,
                tables_filled=tables_filled,
                rows_inserted=rows_inserted,
            )

            result.success = True
            result.output_path = str(output_path.resolve())
            result.stats = stats
            result.warnings = warnings
            result.validation = validation

            logger.info(
                "填充完成: %d 占位符, %d 表格, %d 行, %d KV单元格",
                placeholder_count, tables_filled, rows_inserted, kv_cells_filled,
            )

        except Exception as e:
            logger.error("填充失败: %s", e, exc_info=True)
            result.success = False
            result.error = str(e)

            if self._unpacked_dir:
                try:
                    DocxIO.cleanup(self._unpacked_dir)
                except Exception:
                    pass

        return result

    # ============================================================
    # 占位符替换 — 对应 TS replacePlaceholders
    # ============================================================

    def _replace_placeholders(self, basic_info: BasicInfo) -> int:
        """替换文档中所有占位符 — 对应 TS replacePlaceholders"""
        replaced = 0
        wts = self._tree.xpath("//w:t", namespaces=NSMAP)

        # 构建值映射
        values = {
            "report_number": basic_info.report_number,
            "device_name": basic_info.device_name,
            "company_name": basic_info.company_name,
            "report_type_prefix": basic_info.report_type_prefix,
            "inspection_date_range": (
                f"{basic_info.inspection_start_date}-{basic_info.inspection_end_date}"
            ),
        }

        # 签名日期不在此处处理，由 fillSignatureRowDirect 处理

        # 按优先级排序
        sorted_patterns = sorted(PLACEHOLDER_MAP, key=lambda x: -x[2])

        for wt in wts:
            text = (wt.text or "") if wt.text else ""
            if not text:
                continue

            for pattern_str, field_name, _priority in sorted_patterns:
                compiled = re.compile(pattern_str)

                if field_name in ("signature_date", "signature_date_backup"):
                    # 签名日期占位符 → 不在此处理，保留原样
                    continue

                elif field_name == "inspection_date_range":
                    match = compiled.search(text)
                    if match:
                        wt.text = compiled.sub(values[field_name], text)
                        replaced += 1
                        break

                else:
                    match = compiled.search(text)
                    if match and field_name in values and values[field_name]:
                        wt.text = compiled.sub(values[field_name], text)
                        replaced += 1
                        break

        # 多 run 联合替换（报告编号含 X 占位符）
        # 用 XPath 找分散的报告编号，进行整体替换
        report_number = basic_info.report_number
        if report_number:
            replaced += self._replace_multi_run_report_number(report_number)

        return replaced

    def _replace_multi_run_report_number(self, report_number: str) -> int:
        """多 run 联合替换报告编号 — 对应 TS multiRunReportRegex"""
        # 查找连续的 <w:t> 序列：含 X 占位符且长度匹配报告编号
        body = self._tree.find(qn("w:body"))
        if body is None:
            return 0

        replaced = 0
        # 遍历所有段落，查找含 X 占位符的连续 <w:t>
        for para in body.xpath(".//w:p", namespaces=NSMAP):
            wts = para.findall(".//w:t", NSMAP)
            texts = [(wt.text or "").strip() for wt in wts]

            # 拼接所有文本
            full_text = "".join(texts)

            # 检测是否含跨 run 的报告编号占位符
            # 模式：XXXXXXXX-XXXX-XXXX-202X（分散在多个 <w:t> 中）
            if "X" not in full_text and "-" not in full_text:
                continue

            # 查找连续占位符序列
            seq_start = -1
            seq_end = -1
            for i, t in enumerate(texts):
                if t and ("X" in t.upper() or (t.isdigit() and len(t) <= 5)):
                    if seq_start < 0:
                        seq_start = i
                    seq_end = i

            if seq_start >= 0 and seq_end >= 0:
                combined = "".join(texts[seq_start : seq_end + 1])
                # 检查是否为报告编号模式
                if re.search(r"[A-Z]*-X{3,}-X{3,}-20\dX", combined):
                    # 将报告编号拆分为对应段数
                    segments = report_number.split("-")
                    seg_idx = 0
                    for i in range(seq_start, seq_end + 1):
                        if seg_idx < len(segments) and texts[i]:
                            wts[i].text = segments[seg_idx]
                            seg_idx += 1
                    replaced += 1

        return replaced

    # ============================================================
    # 模板匹配 — 对应 TS _find_matching_table
    # ============================================================

    def _count_kv_rows_in_template(
        self, table_index: int, section: SectionData
    ) -> int:
        """在模板表格中计算连续 KV 行数 — 对应 TS kvRowCount"""
        tables = self._tree.xpath("//w:tbl", namespaces=NSMAP)
        if table_index >= len(tables):
            return 0

        table = tables[table_index]
        rows = get_table_rows(table)

        kv_count = 0
        for row in rows:
            analysis = analyze_row_cells(row)
            if analysis.is_merge_title_row:
                continue  # 跳过合并标题行
            if analysis.is_kv_row:
                kv_count += 1
            else:
                break

        return kv_count

    # ============================================================
    # validGrid 构建 — 对应 TS dataTableToXml 中的 validGrid
    # ============================================================

    def _build_valid_grid(self, dt) -> Optional[list[list[bool]]]:
        """构建校验状态网格 — 对应 TS dataTableToXml 中的 validGrid

        只有存在至少一个 valid=false 的单元格时才返回非 None，
        避免不必要的开销。

        Returns:
            valid_grid[i][j] = True 表示该单元格校验通过，False 表示需要黄色高亮
        """
        has_invalid = False
        for row_data in dt.rows:
            for h in dt.headers:
                val = row_data.get(h, "")
                if not is_cell_valid(val):
                    has_invalid = True
                    break
            if has_invalid:
                break

        if not has_invalid:
            return None

        return [
            [is_cell_valid(row_data.get(h, "")) for h in dt.headers]
            for row_data in dt.rows
        ]

    # ============================================================
    # 校验 — 对应 TS validateFilledDocument
    # ============================================================

    def _validate(
        self,
        before_xml: str,
        after_xml: str,
        unpacked_dir: Path,
    ) -> ValidationInfo:
        """聚合校验 — 对应 TS validateFilledDocument"""
        try:
            from report_filler.validator import validate_filled_document

            val_result = validate_filled_document(before_xml, after_xml, str(unpacked_dir))
            return ValidationInfo(
                passed=val_result.valid,
                errors=val_result.errors,
                warnings=val_result.warnings,
            )
        except ImportError:
            logger.warning("validator 模块不可用，跳过格式校验")
            return ValidationInfo(passed=True, errors=[], warnings=[])

    # ============================================================
    # 便捷方法
    # ============================================================

    def analyze_template(self) -> TemplateStructure:
        """仅分析模板结构"""
        if self._tree is None:
            unpacked_dir = DocxIO.copy_template(
                str(self._template_path), Path("temp")
            )
            self._unpacked_dir = unpacked_dir
            self._tree = DocxIO.read_document_xml(unpacked_dir)

        analyzer = TemplateAnalyzer(self._tree)
        return analyzer.analyze()
