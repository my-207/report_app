"""
年度检查报告自动填充 — Python XML 处理核心

提供三层接口：
  - Python API: from report_filler import ReportFiller
  - CLI: report-filler analyze/fill/validate
  - Shell Wrappers: scripts/fill.sh
"""

__version__ = "1.0.0"
__description__ = "年度检查报告自动填充 - XML 处理核心"

from report_filler.models import (
    BasicInfo,
    KeyValuePair,
    SignatureBlock,
    DataTable,
    SectionData,
    UnifiedReportData,
    ReportData,
    TemplateStructure,
    TemplateSection,
    TemplateTableInfo,
    FillResult,
    FillStats,
    ValidationInfo,
    RowCellInfo,
    PlaceholderRule,
    DEFAULT_PLACEHOLDER_MAP,
)

from report_filler.docx_io import DocxIO

__all__ = [
    # 版本
    "__version__",
    # 数据模型
    "BasicInfo",
    "KeyValuePair",
    "SignatureBlock",
    "DataTable",
    "SectionData",
    "UnifiedReportData",
    "ReportData",
    # 模板结构
    "TemplateStructure",
    "TemplateSection",
    "TemplateTableInfo",
    # 结果
    "FillResult",
    "FillStats",
    "ValidationInfo",
    # 工具
    "RowCellInfo",
    "PlaceholderRule",
    "DEFAULT_PLACEHOLDER_MAP",
    # IO
    "DocxIO",
]
