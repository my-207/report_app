"""
CLI 入口 — 基于 Click 的命令行接口

用法:
    report-filler analyze --template template.docx
    report-filler fill --template template.docx --data data.json --output output.docx
    report-filler validate --template template.docx --data data.json
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Optional

import click
import yaml

from report_filler import __version__
from report_filler.docx_io import DocxIO
from report_filler.models import (
    BasicInfo,
    KeyValuePair,
    DataTable,
    SectionData,
    UnifiedReportData,
    SignatureBlock,
    FillResult,
)
from report_filler.filler import ReportFiller
from report_filler.template_analyzer import TemplateAnalyzer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

logger = logging.getLogger("report_filler.cli")


# ============================================================
# 主命令组
# ============================================================


@click.group()
@click.version_option(version=__version__, prog_name="report-filler")
def main():
    """年度检查报告自动填充 — Python XML 处理核心

    三种子命令：
      analyze  — 分析模板结构
      fill     — 填充报告
      validate — 校验已填充文档
    """


# ============================================================
# analyze — 分析模板
# ============================================================


@main.command()
@click.option("--template", "-t", required=True, type=click.Path(exists=True),
              help="模板 .docx 文件路径")
@click.option("--output", "-o", default=None, type=click.Path(),
              help="输出 JSON 文件路径（默认输出到控制台）")
def analyze(template: str, output: Optional[str]):
    """分析模板 .docx 的表格结构和占位符"""
    try:
        # 解包
        unpacked = DocxIO.copy_template(template, Path("_tmp_analyze"))
        tree = DocxIO.read_document_xml(unpacked)

        # 分析
        analyzer = TemplateAnalyzer(tree)
        structure = analyzer.analyze()

        # 序列化
        result = {
            "sections": [
                {
                    "section_id": s.section_id,
                    "placeholder_fields": [
                        {"map_to": f.map_to, "pattern": f.pattern}
                        for f in s.placeholder_fields
                    ],
                    "tables": [
                        {
                            "table_index": t.table_index,
                            "is_key_value": t.is_key_value,
                            "is_hybrid": t.is_hybrid,
                            "kv_keys": t.kv_keys,
                            "columns": t.columns,
                        }
                        for t in s.tables
                    ],
                    "has_signature": s.signature_position is not None,
                    "signature_fields": s.signature_fields,
                }
                for s in structure.sections
                if s.section_id != "_placeholders"  # 跳过纯占位符章节
            ],
            "placeholder_section": {
                "fields": [
                    {"map_to": f.map_to, "pattern": f.pattern}
                    for s in structure.sections
                    if s.section_id == "_placeholders"
                    for f in s.placeholder_fields
                ]
            },
            "total_tables": len({
                t.table_index
                for s in structure.sections
                for t in s.tables
            }),
        }

        json_str = json.dumps(result, ensure_ascii=False, indent=2)

        if output:
            Path(output).write_text(json_str, encoding="utf-8")
            click.echo(f"分析结果已写入: {output}")
        else:
            click.echo(json_str)

        # 清理
        DocxIO.cleanup(unpacked)

    except Exception as e:
        click.echo(f"分析失败: {e}", err=True)
        logger.exception("分析异常")
        sys.exit(1)


# ============================================================
# fill — 填充报告
# ============================================================


@main.command()
@click.option("--template", "-t", required=True, type=click.Path(exists=True),
              help="模板 .docx 文件路径")
@click.option("--data", "-d", required=True, type=click.Path(exists=True),
              help="数据文件路径 (.json / .yaml)")
@click.option("--output", "-o", default="output.docx", type=click.Path(),
              help="输出 .docx 文件路径")
@click.option("--verbose", "-v", is_flag=True, help="显示详细日志")
def fill(template: str, data: str, output: str, verbose: bool):
    """用数据填充报告模板并输出 .docx"""
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    try:
        # 加载数据
        report_data = _load_data(data)

        # 填充
        filler = ReportFiller(template)
        result = filler.fill(report_data, output)

        # 输出结果
        if result.success:
            click.echo(f"✓ 填充成功")
            click.echo(f"  输出文件: {result.output_path}")
            click.echo(f"  占位符替换: {result.stats.placeholders_replaced}")
            click.echo(f"  表格填充: {result.stats.tables_filled}")
            click.echo(f"  行/单元格插入: {result.stats.rows_inserted}")

            if result.validation:
                v = result.validation
                click.echo(f"  格式校验: {'✓ 通过' if v.passed else '✗ 失败'}")
                if v.warnings:
                    click.echo(f"  警告: {len(v.warnings)} 条")
                if v.errors:
                    click.echo(f"  错误: {len(v.errors)} 条")
                    for e in v.errors[:5]:
                        click.echo(f"    - {e}")

            if result.warnings:
                for w in result.warnings:
                    click.echo(f"  ⚠ {w}")

        else:
            click.echo(f"✗ 填充失败: {result.error}", err=True)
            sys.exit(1)

    except Exception as e:
        click.echo(f"运行失败: {e}", err=True)
        logger.exception("填充异常")
        sys.exit(1)


# ============================================================
# validate — 校验
# ============================================================


@main.command()
@click.option("--template", "-t", required=True, type=click.Path(exists=True),
              help="模板 .docx 文件路径（用于对比）")
@click.option("--data", "-d", required=True, type=click.Path(exists=True),
              help="数据文件路径 (.json / .yaml)")
def validate(template: str, data: str):
    """比较模板和已填充文档的结构一致性"""
    try:
        report_data = _load_data(data)

        filler = ReportFiller(template)
        result = filler.fill(report_data, "_validate_output.docx")

        if result.validation:
            v = result.validation
            if v.passed:
                click.echo("✓ 校验通过")
                if v.warnings:
                    click.echo(f"  警告 ({len(v.warnings)} 条):")
                    for w in v.warnings:
                        click.echo(f"    ⚠ {w}")
            else:
                click.echo("✗ 校验失败")
                click.echo(f"  错误 ({len(v.errors)} 条):")
                for e in v.errors:
                    click.echo(f"    ✗ {e}")

        # 清理
        Path("_validate_output.docx").unlink(missing_ok=True)

    except Exception as e:
        click.echo(f"校验失败: {e}", err=True)
        sys.exit(1)


# ============================================================
# 数据加载辅助
# ============================================================


def _load_data(filepath: str) -> UnifiedReportData:
    """从 JSON/YAML 文件加载 UnifiedReportData"""
    path = Path(filepath)
    suffix = path.suffix.lower()

    if suffix == ".json":
        raw = json.loads(path.read_text(encoding="utf-8"))
    elif suffix in (".yaml", ".yml"):
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    else:
        raise ValueError(f"不支持的数据格式: {suffix}，仅支持 .json / .yaml")

    return _dict_to_unified_report(raw)


def _dict_to_unified_report(raw: dict) -> UnifiedReportData:
    """将字典转换为 UnifiedReportData 对象"""
    # BasicInfo
    bi = raw.get("basicInfo", raw.get("basic_info", {}))
    basic_info = BasicInfo(
        report_number=bi.get("reportNumber", bi.get("report_number", "")),
        company_name=bi.get("companyName", bi.get("company_name", "")),
        device_name=bi.get("deviceName", bi.get("device_name", "")),
        report_type_prefix=bi.get("reportTypePrefix", bi.get("report_type_prefix", "")),
        inspection_start_date=bi.get("inspectionStartDate", bi.get("inspection_start_date", "")),
        inspection_end_date=bi.get("inspectionEndDate", bi.get("inspection_end_date", "")),
        inspector_date=bi.get("inspectorDate", bi.get("inspector_date", "")),
        checker_date=bi.get("checkerDate", bi.get("checker_date", "")),
        reviewer_date=bi.get("reviewerDate", bi.get("reviewer_date", "")),
    )

    # Sections
    sections: list[SectionData] = []
    for s in raw.get("sections", []):
        # KV pairs
        kv_pairs = [
            KeyValuePair(key=kv.get("key", ""), value=kv.get("value", ""))
            for kv in s.get("kvPairs", s.get("kv_pairs", []))
        ]

        # Tables
        tables = []
        for t in s.get("tables", []):
            tables.append(DataTable(
                table_type=t.get("tableType", t.get("table_type", "")),
                headers=t.get("headers", []),
                rows=t.get("rows", []),
            ))

        # Signature
        sig = None
        sig_data = s.get("signature")
        if sig_data:
            sig = SignatureBlock(
                inspector_name=sig_data.get("inspectorName", sig_data.get("inspector_name", "")),
                inspector_date=sig_data.get("inspectorDate", sig_data.get("inspector_date", "")),
                checker_name=sig_data.get("checkerName", sig_data.get("checker_name", "")),
                checker_date=sig_data.get("checkerDate", sig_data.get("checker_date", "")),
                reviewer_name=sig_data.get("reviewerName", sig_data.get("reviewer_name", "")),
                reviewer_date=sig_data.get("reviewerDate", sig_data.get("reviewer_date", "")),
            )

        sections.append(SectionData(
            id=s.get("id", ""),
            title=s.get("title", ""),
            kv_pairs=kv_pairs,
            tables=tables,
            signature=sig,
            table_index=s.get("tableIndex", s.get("table_index")),
            has_hybrid_table=s.get("hasHybridTable", s.get("has_hybrid_table", False)),
            has_nested_kv_table=s.get("hasNestedKvTable", s.get("has_nested_kv_table", False)),
            hybrid_list_header_rows=s.get("hybridListHeaderRows", s.get("hybrid_list_header_rows", 0)),
        ))

    return UnifiedReportData(basic_info=basic_info, sections=sections)


# ============================================================
# 入口
# ============================================================

if __name__ == "__main__":
    main()
