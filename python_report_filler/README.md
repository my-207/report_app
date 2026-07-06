# 年度检查报告自动填充 — Python XML 处理核心

将 `.docx` 模板 + JSON/YAML 数据 → 自动填充 → 生成报告。

## 快速开始

### 安装

```bash
# 一键安装
bash scripts/setup.sh       # Linux/macOS
scripts\setup.bat           # Windows PowerShell / CMD

# 或手动安装
pip install -r requirements.txt
pip install -e .
```

### 使用

**CLI 方式：**

```bash
# 分析模板结构
report-filler analyze --template 模板.docx

# 填充报告
report-filler fill --template 模板.docx --data 数据.json --output 报告.docx

# 校验已填充文档
report-filler validate --template 输出.docx --data 数据.json
```

**Python API 方式：**

```python
from report_filler import ReportFiller, UnifiedReportData, BasicInfo

# 构建数据
data = UnifiedReportData(
    basic_info=BasicInfo(
        report_number="GS-2025-0001",
        company_name="XX检测有限公司",
        device_name="压力容器A001",
        report_type_prefix="GGW",
        inspection_start_date="2025年6月",
        inspection_end_date="2025年7月",
    ),
    # ... 填入 sections
)

# 填充
filler = ReportFiller("模板.docx")
result = filler.fill(data, "输出报告.docx")
print(f"成功: {result.success}, 统计: {result.stats}")
```

## 项目结构

```
python_report_filler/
├── src/report_filler/      # 主包
│   ├── models.py           # 数据模型 (dataclass)
│   ├── docx_io.py          # DOCX 解包/打包 (zipfile)
│   ├── xml_utils.py        # XPath XML 工具集 (lxml)
│   ├── template_analyzer.py # 模板结构分析
│   ├── xml_subtree_inserter.py # XML 子树插入引擎
│   ├── filler.py           # 填充协调器
│   ├── validator.py        # 格式校验
│   └── cli.py              # Click CLI 入口
├── tests/                  # pytest 测试
├── examples/               # 使用示例
├── scripts/                # Shell 包装脚本
└── pyproject.toml          # 包配置
```

## 技术栈

- **lxml** — XML 解析（XPath + Element API）
- **click** — CLI 框架
- **PyYAML** — YAML 数据解析
- **pytest** — 测试框架
