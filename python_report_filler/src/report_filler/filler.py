"""
填充协调器 — 对应 TS filler.service.ts

编排整个填充流程：
  1. 占位符替换（文本模式匹配）
  2. KV 表格填充 + 列表表格填充 + 签名行填充
  3. 输出 .docx

提供高层 ReportFiller 类作为 Python API 入口。
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
)
from report_filler.template_analyzer import TemplateAnalyzer
from report_filler.xml_subtree_inserter import XmlSubtreeInserter
from report_filler.xml_utils import (
    qn,
    NSMAP,
    cell_merged_text,
)

logger = logging.getLogger("report_filler")

# ============================================================
# 占位符映射表（与 TS filler.service.ts PLACEHOLDER_MAP 对齐）
# ============================================================

PLACEHOLDER_MAP: list[tuple[str, str, int]] = [
    # (正则模式, BasicInfo字段名, 优先级)
    (r"XXXXX-XXXX-XXXX-20\dX", "report_number", 10),
    (r"XXXXXXXXXXXX(?!公司)", "device_name", 9),
    (r"XXXXXXX公司", "company_name", 8),
    (r"XXXXXXXXX/XXXXXXXX/XXXXX/XXXXXX", "report_type_prefix", 7),
    (r"20\dX年\d{1,2}月-20\dX年\d{1,2}月", "inspection_date_range", 6),
    (r"20\dX年\d{1,2}月\d{1,2}日", "signature_date", 5),
]


class ReportFiller:
    """报告填充器 — 主 Python API 入口"""

    def __init__(self, template_path: str | Path):
        """
        Args:
            template_path: .docx 模板文件路径
        """
        self._template_path = Path(template_path)
        self._inserter = XmlSubtreeInserter()
        self._tree: Optional[etree._Element] = None
        self._unpacked_dir: Optional[Path] = None

    # ============================================================
    # 主入口
    # ============================================================

    def fill(
        self,
        data: UnifiedReportData,
        output_path: str | Path,
    ) -> FillResult:
        """主入口：填充数据到模板并输出 .docx

        Args:
            data: 统一报告数据
            output_path: 输出 .docx 路径

        Returns:
            FillResult { success, output_path, stats, warnings, validation }
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

            # 3. 保存填充前 XML（供校验对比）
            before_xml = DocxIO.read_document_xml_raw(unpacked_dir)

            # 4. 占位符替换
            logger.info("替换占位符...")
            placeholder_count = self._replace_placeholders(data.basic_info)

            # 5. 分析模板结构
            logger.info("分析模板结构...")
            analyzer = TemplateAnalyzer(self._tree)
            template_structure = analyzer.analyze()

            # 6. 逐 Section 填充
            logger.info("填充表格数据...")
            tables_filled = 0
            rows_inserted = 0

            for section in data.sections:
                if section.tables:
                    for table_data in section.tables:
                        target_idx = section.table_index
                        if target_idx is None:
                            # 尝试从模板结构中找到匹配的表格
                            target_idx = self._find_matching_table(
                                template_structure, section, table_data
                            )

                        if target_idx is not None:
                            data_start = section.hybrid_list_header_rows if section.has_hybrid_table else 0

                            rows = self._inserter.fill_table_from_source(
                                self._tree,
                                target_idx,
                                {
                                    "headers": table_data.headers,
                                    "rows": table_data.rows,
                                },
                                data_start_row=data_start,
                                signature_block=section.signature,
                            )
                            rows_inserted += rows
                            tables_filled += 1
                        else:
                            warnings.append(
                                f"Section {section.id}: 未找到匹配的模板表格"
                            )

                elif section.kv_pairs:
                    # 纯 KV 表填充
                    target_idx = section.table_index
                    if target_idx is not None:
                        kv_data = {kv.key: kv.value for kv in section.kv_pairs}
                        cells = self._inserter.fill_key_value_table(
                            self._tree, target_idx, kv_data
                        )
                        if cells > 0:
                            tables_filled += 1
                            rows_inserted += cells

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
                f"填充完成: {placeholder_count} 占位符, "
                f"{tables_filled} 表格, {rows_inserted} 行"
            )

        except Exception as e:
            logger.error(f"填充失败: {e}", exc_info=True)
            result.success = False
            result.error = str(e)

            # 清理临时文件
            if self._unpacked_dir:
                try:
                    DocxIO.cleanup(self._unpacked_dir)
                except Exception:
                    pass

        return result

    # ============================================================
    # 占位符替换
    # ============================================================

    def _replace_placeholders(self, basic_info: BasicInfo) -> int:
        """替换文档中所有占位符 — 对应 TS filler.service.ts replacePlaceholders

        Args:
            basic_info: 基本信息

        Returns:
            替换的占位符数量
        """
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

        # 按优先级排序
        sorted_patterns = sorted(PLACEHOLDER_MAP, key=lambda x: -x[2])

        for wt in wts:
            text = (wt.text or "") if wt.text else ""
            if not text:
                continue

            for pattern_str, field_name, _priority in sorted_patterns:
                compiled = re.compile(pattern_str)

                if field_name == "signature_date":
                    # 签名日期：逐个替换
                    match = compiled.search(text)
                    if match:
                        # 尝试匹配具体角色
                        new_date = self._resolve_signature_date(
                            text, basic_info
                        )
                        if new_date is not None:
                            new_text = compiled.sub(new_date, text)
                            if new_text != text:
                                wt.text = new_text
                                replaced += 1
                                break

                elif field_name == "inspection_date_range":
                    match = compiled.search(text)
                    if match:
                        wt.text = compiled.sub(values[field_name], text)
                        replaced += 1
                        break

                else:
                    match = compiled.search(text)
                    if match and field_name in values:
                        wt.text = compiled.sub(values[field_name], text)
                        replaced += 1
                        break

        return replaced

    def _resolve_signature_date(
        self, text: str, basic_info: BasicInfo
    ) -> Optional[str]:
        """根据上下文判断签名日期属于哪个角色"""
        if "检测" in text or "检查" in text:
            return basic_info.inspector_date
        if "校对" in text:
            return basic_info.checker_date
        if "审核" in text or "审批" in text:
            return basic_info.reviewer_date

        # 默认返回检测日期
        return basic_info.inspector_date

    # ============================================================
    # 模板匹配
    # ============================================================

    def _find_matching_table(
        self,
        template: TemplateStructure,
        section: SectionData,
        table_data,
    ) -> Optional[int]:
        """在模板结构中查找匹配的表格索引"""
        # 先尝试通过 section.id 匹配
        for ts in template.sections:
            if ts.section_id == section.id and ts.tables:
                return ts.tables[0].table_index

        # 回退：通过表格列名匹配
        if table_data.headers:
            for ts in template.sections:
                for tbl in ts.tables:
                    if tbl.columns:
                        template_headers = [c.get("header", "") for c in tbl.columns]
                        # 简单匹配：有共同的列名
                        common = set(table_data.headers) & set(template_headers)
                        if len(common) >= 2:
                            return tbl.table_index

        # 使用 section 自己的 table_index
        return section.table_index

    # ============================================================
    # 校验
    # ============================================================

    def _validate(
        self,
        before_xml: str,
        after_xml: str,
        unpacked_dir: Path,
    ) -> ValidationInfo:
        """聚合校验 — 对应 TS validateFilledDocument"""
        from report_filler.validator import validate_filled_document
        result = validate_filled_document(before_xml, after_xml, str(unpacked_dir))
        return ValidationInfo(
            passed=result.valid,
            errors=result.errors,
            warnings=result.warnings,
        )

    # ============================================================
    # 便捷方法
    # ============================================================

    def analyze_template(self) -> TemplateStructure:
        """仅分析模板结构（不解压、不填充）"""
        if self._tree is None:
            unpacked_dir = DocxIO.copy_template(
                str(self._template_path), Path("temp")
            )
            self._unpacked_dir = unpacked_dir
            self._tree = DocxIO.read_document_xml(unpacked_dir)

        analyzer = TemplateAnalyzer(self._tree)
        return analyzer.analyze()
