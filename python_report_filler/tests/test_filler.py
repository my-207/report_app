"""端到端填充测试"""

import tempfile
from pathlib import Path

from report_filler.filler import ReportFiller
from report_filler.cli import _load_data


def test_fill_end_to_end(template_path, sample_data, tmp_path):
    """端到端测试：模板 → 填充 → 输出 .docx"""
    from report_filler.docx_io import DocxIO

    # 构建数据
    report_data = _load_data(  # type: ignore
        str(_write_sample_json(tmp_path, sample_data))
    )

    # 填充
    output = tmp_path / "test_output.docx"
    filler = ReportFiller(str(template_path))
    result = filler.fill(report_data, str(output))

    assert result.success, f"填充失败: {result.error}"
    assert output.exists()
    assert output.stat().st_size > 1000

    # 验证校验结果
    if result.validation:
        assert result.validation.errors == [], f"校验错误: {result.validation.errors}"
        # 警告是允许的（行数增加等正常现象）
        print(f"校验警告: {result.validation.warnings}")

    # 验证输出文件可被解包
    with tempfile.TemporaryDirectory() as verify:
        word_dir = DocxIO.unpack(str(output), verify)
        assert (Path(word_dir) / "document.xml").exists()


def test_fill_with_validation(template_path, sample_data, tmp_path):
    """测试填充 + 校验流程"""
    report_data = _load_data(
        str(_write_sample_json(tmp_path, sample_data))
    )

    output = tmp_path / "validated_output.docx"
    filler = ReportFiller(str(template_path))
    result = filler.fill(report_data, str(output))

    assert result.success
    assert result.validation is not None
    assert result.validation.passed, f"校验失败: {result.validation.errors}"


def _write_sample_json(tmp_path: Path, data: dict) -> Path:
    """写入示例数据文件"""
    import json
    p = tmp_path / "sample_data.json"
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return p
