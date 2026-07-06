"""pytest 共享 fixtures"""

import json
from pathlib import Path

import pytest


@pytest.fixture
def template_path() -> Path:
    """获取模板文件路径"""
    p = Path(__file__).parent.parent.parent / "年度检查报告（模版）.docx"
    if not p.exists():
        pytest.skip("模板文件不存在")
    return p


@pytest.fixture
def sample_data() -> dict:
    """示例填充数据（与现有 TS 系统对齐）"""
    return {
        "basicInfo": {
            "reportNumber": "GS-2025-0001-TEST",
            "companyName": "测试检测有限公司",
            "deviceName": "压力容器A001",
            "reportTypePrefix": "GGW",
            "inspectionStartDate": "2025年6月",
            "inspectionEndDate": "2025年7月",
            "inspectorDate": "2025年7月10日",
            "checkerDate": "2025年7月12日",
            "reviewerDate": "2025年7月15日",
        },
        "sections": [
            {
                "id": "1-1",
                "title": "原始资料审查报告",
                "kvPairs": [
                    {"key": "设计单位", "value": "XX设计院"},
                    {"key": "制造单位", "value": "XX制造厂"},
                    {"key": "安装单位", "value": "XX安装公司"},
                    {"key": "检验单位", "value": "XX检验机构"},
                ],
                "signature": {
                    "inspectorName": "张三",
                    "inspectorDate": "2025年7月10日",
                    "checkerName": "李四",
                    "checkerDate": "2025年7月12日",
                    "reviewerName": "王五",
                    "reviewerDate": "2025年7月15日",
                },
            },
        ],
    }
