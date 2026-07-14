"""
年度检查报告自动填充 — 数据模型定义

所有 dataclass 与 TypeScript types/index.ts 一一对应。
字段命名采用 Python snake_case 惯例，通过别名映射支持 JSON 反序列化。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# ============================================================
# 数据层 — 与 TS UnifiedReportData 对应
# ============================================================


@dataclass
class BasicInfo:
    """基本信息 — 对应 TS BasicInfo"""
    report_number: str = ""          # 报告编号，格式: XXXXX-XXXX-XXXX-20XX
    company_name: str = ""           # 单位名称
    device_name: str = ""            # 设备名称
    report_type_prefix: str = ""     # 报告类型前缀，如 "GGW"
    inspection_start_date: str = ""  # 检验起始日期，格式: YYYY年M月
    inspection_end_date: str = ""    # 检验结束日期，格式: YYYY年M月
    inspector_date: str = ""         # 检测人签名日期，格式: YYYY年M月DD日
    checker_date: str = ""           # 校对人签名日期
    reviewer_date: str = ""          # 审核人签名日期


@dataclass
class KeyValuePair:
    """键值对 — 对应 TS KeyValuePair"""
    key: str = ""
    value: str = ""


@dataclass
class SignatureBlock:
    """签名数据 — 对应 TS SignatureBlock"""
    inspector_name: str = ""
    inspector_date: str = ""
    checker_name: str = ""
    checker_date: str = ""
    reviewer_name: str = ""
    reviewer_date: str = ""


@dataclass
class DataTable:
    """列表型表格 — 对应 TS DataTable"""
    table_type: str = ""                     # 实体类型标识
    headers: list[str] = field(default_factory=list)  # 列名（中文表头）
    rows: list[dict[str, str]] = field(default_factory=list)  # 数据行，header → value 映射


@dataclass
class SectionData:
    """章节数据 — 对应 TS SectionData"""
    id: str = ""                              # 章节编号 "1-1""2-3"
    title: str = ""                           # 章节标题
    kv_pairs: list[KeyValuePair] = field(default_factory=list)
    tables: list[DataTable] = field(default_factory=list)
    signature: Optional[SignatureBlock] = None
    # 模板定位辅助字段
    table_index: Optional[int] = None         # 对应模板中的表格索引
    has_hybrid_table: bool = False            # 混合表标记
    has_nested_kv_table: bool = False         # 嵌套KV表标记（含vMerge层级结构）
    hybrid_list_header_rows: int = 0          # 混合表列表表头占用行数


@dataclass
class UnifiedReportData:
    """统一报告数据（纯数据层，不含 Word XML）— 对应 TS UnifiedReportData"""
    basic_info: BasicInfo = field(default_factory=BasicInfo)
    sections: list[SectionData] = field(default_factory=list)


@dataclass
class ReportData:
    """完整报告数据（旧版）— 对应 TS ReportData"""
    basic_info: BasicInfo = field(default_factory=BasicInfo)
    tables: list[TableData] = field(default_factory=list)


# ============================================================
# 模板结构 — 与 TS TemplateStructure 对应
# ============================================================


@dataclass
class TemplateTableInfo:
    """模板中单个表格的结构信息"""
    table_index: int = 0
    is_key_value: bool = False
    is_hybrid: bool = False
    is_nested_kv: bool = False          # 嵌套KV表标记（含vMerge层级结构）
    hybrid_list_header_rows: int = 0
    kv_keys: list[str] = field(default_factory=list)
    columns: list[dict] = field(default_factory=list)  # { header, mapped_field }


@dataclass
class PlaceholderField:
    """占位符字段"""
    map_to: str = ""
    pattern: str = ""


@dataclass
class TemplateSection:
    """模板章节结构 — 对应 TS TemplateSection"""
    section_id: str = ""
    placeholder_fields: list[PlaceholderField] = field(default_factory=list)
    tables: list[TemplateTableInfo] = field(default_factory=list)
    signature_position: Optional[dict] = None  # { table_index: int }
    signature_fields: list[str] = field(default_factory=list)


@dataclass
class TemplateStructure:
    """模板结构定义 — 对应 TS TemplateStructure"""
    sections: list[TemplateSection] = field(default_factory=list)


# ============================================================
# 填充结果 — 与 TS FillResult / FillStats / ValidationInfo 对应
# ============================================================


@dataclass
class FillStats:
    """填充统计 — 对应 TS FillStats"""
    placeholders_replaced: int = 0
    tables_filled: int = 0
    rows_inserted: int = 0


@dataclass
class ValidationInfo:
    """校验结果 — 对应 TS ValidationInfo"""
    passed: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class FillResult:
    """填充结果 — 对应 TS FillResult"""
    success: bool = False
    output_path: str = ""              # 输出文件路径
    stats: FillStats = field(default_factory=FillStats)
    warnings: list[str] = field(default_factory=list)
    error: Optional[str] = None
    validation: Optional[ValidationInfo] = None


# ============================================================
# XML 行分析结果
# ============================================================


@dataclass
class RowCellInfo:
    """单行分析结果（由 analyze_row_cells 产出）"""
    cells: list[dict] = field(default_factory=list)   # [{ text, grid_span, v_merge, is_empty }]
    is_kv_row: bool = False
    is_header_row: bool = False
    is_data_row: bool = False
    is_signature_row: bool = False
    is_empty: bool = False
    physical_count: int = 0          # 物理单元格数
    logical_count: int = 0           # 逻辑列数（考虑 gridSpan）
    non_empty_ratio: float = 0.0     # 非空单元格比例


# ============================================================
# 占位符映射表
# ============================================================


@dataclass
class PlaceholderRule:
    """占位符替换规则"""
    regex: str                        # 正则模式
    field: str                        # 映射到 BasicInfo 的字段名
    priority: int = 0                 # 优先级（数值越大越先匹配）


# ============================================================
# 校验辅助函数 — 对应 TS getValidationText / isCellValid
# ============================================================


def get_validation_text(val) -> str:
    """提取纯文本值，兼容 str | dict — 对应 TS getValidationText

    支持格式：
      - "3.8" → "3.8"
      - {"value": "3.8", "valid": false, "reason": "..."} → "3.8"
    """
    if isinstance(val, str):
        return val
    if isinstance(val, dict):
        return str(val.get("value", ""))
    return str(val) if val else ""


def is_cell_valid(val) -> bool:
    """判断单元格值是否通过校验 — 对应 TS isCellValid

    返回 True 表示校验通过（正常），False 表示需要高亮黄色。
    纯字符串格式始终返回 True。
    """
    if isinstance(val, str):
        return True
    if isinstance(val, dict):
        return val.get("valid", True)
    return True


# 默认占位符映射表（与 TS filler.service.ts PLACEHOLDER_MAP 对齐）
DEFAULT_PLACEHOLDER_MAP: list[PlaceholderRule] = [
    # 报告编号: XXXXX-XXXX-XXXX-202X
    PlaceholderRule(
        regex=r"XXXXX-XXXX-XXXX-20\dX",
        field="report_number",
        priority=10,
    ),
    # 设备名称: XXXXXXXXXXXX
    PlaceholderRule(
        regex=r"XXXXXXXXXXXX(?!公司)",
        field="device_name",
        priority=9,
    ),
    # 公司名称: XXXXXXX公司
    PlaceholderRule(
        regex=r"XXXXXXX公司",
        field="company_name",
        priority=8,
    ),
    # 报告类型前缀: XXXXXXXXX/XXXXXXXX/XXXXX/XXXXXX
    PlaceholderRule(
        regex=r"XXXXXXXXX/XXXXXXXX/XXXXX/XXXXXX",
        field="report_type_prefix",
        priority=7,
    ),
    # 检验日期段: 202X年6月-202X年7月
    PlaceholderRule(
        regex=r"20\dX年\d{1,2}月-20\dX年\d{1,2}月",
        field="inspection_date_range",
        priority=6,
    ),
    # 签名日期: 202X年X月XX日
    PlaceholderRule(
        regex=r"20\dX年\d{1,2}月\d{1,2}日",
        field="signature_date",
        priority=5,
    ),
]
