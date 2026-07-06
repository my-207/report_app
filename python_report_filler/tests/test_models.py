"""测试数据模型"""

from report_filler.models import (
    BasicInfo,
    KeyValuePair,
    SignatureBlock,
    DataTable,
    SectionData,
    UnifiedReportData,
    FillResult,
    FillStats,
    ValidationInfo,
    TemplateStructure,
    TemplateSection,
    TemplateTableInfo,
    DEFAULT_PLACEHOLDER_MAP,
)


def test_basic_info_defaults():
    bi = BasicInfo()
    assert bi.report_number == ""
    assert bi.company_name == ""


def test_basic_info_full():
    bi = BasicInfo(
        report_number="GS-2025-0001",
        company_name="XX检测有限公司",
        device_name="设备A",
        report_type_prefix="GGW",
        inspection_start_date="2025年6月",
        inspection_end_date="2025年7月",
        inspector_date="2025年7月10日",
        checker_date="2025年7月12日",
        reviewer_date="2025年7月15日",
    )
    assert bi.report_number == "GS-2025-0001"
    assert len(bi.__dict__) == 9


def test_key_value_pair():
    kv = KeyValuePair(key="设计单位", value="XX设计院")
    assert kv.key == "设计单位"
    assert kv.value == "XX设计院"


def test_data_table():
    dt = DataTable(
        table_type="inspection",
        headers=["序号", "项目", "结果"],
        rows=[{"序号": "1", "项目": "测试", "结果": "合格"}],
    )
    assert len(dt.headers) == 3
    assert len(dt.rows) == 1


def test_section_data():
    sd = SectionData(
        id="1-1",
        title="测试章节",
        has_hybrid_table=True,
        hybrid_list_header_rows=2,
    )
    assert sd.id == "1-1"
    assert sd.has_hybrid_table is True


def test_unified_report_data():
    ur = UnifiedReportData(
        basic_info=BasicInfo(report_number="GS-2025-0001"),
        sections=[SectionData(id="1-1")],
    )
    assert ur.basic_info.report_number == "GS-2025-0001"
    assert len(ur.sections) == 1


def test_fill_result():
    fr = FillResult(
        success=True,
        output_path="output.docx",
        stats=FillStats(placeholders_replaced=5, tables_filled=2, rows_inserted=10),
        validation=ValidationInfo(passed=True),
    )
    assert fr.success
    assert fr.stats.placeholders_replaced == 5


def test_template_structure():
    ts = TemplateStructure(
        sections=[TemplateSection(
            section_id="tbl_0",
            placeholder_fields=[],
            tables=[TemplateTableInfo(
                table_index=0,
                is_key_value=True,
                kv_keys=["设计单位", "制造单位"],
            )],
        )]
    )
    assert len(ts.sections) == 1
    assert ts.sections[0].tables[0].is_key_value


def test_placeholder_map():
    assert len(DEFAULT_PLACEHOLDER_MAP) >= 5
    # 验证优先级降序
    for i in range(len(DEFAULT_PLACEHOLDER_MAP) - 1):
        assert DEFAULT_PLACEHOLDER_MAP[i].priority >= DEFAULT_PLACEHOLDER_MAP[i + 1].priority
