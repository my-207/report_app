---
name: python-xml-rewrite
overview: 用 Python + lxml 重写 XML 处理核心模块（template-analyzer + filler + xml-subtree-inserter + xml-utils + xml-validator），生成独立 Python 包，提供 CLI 和 API 两种调用方式。保留 Node.js Web 服务层不变，通过子进程调用 Python 模块。
todos:
  - id: create-models-and-docx-io
    content: 创建 models.py（数据模型 dataclass）和 docx_io.py（docx 解包/打包，参考 [skill:docx] 的 unpack/pack 工具链）
    status: completed
  - id: create-xml-utils
    content: 实现 xml_utils.py：用 lxml 重写 extractTagContent/getCellMergedTexts/analyzeRowCells/isKeyValueTable，用 XPath 替代正则匹配
    status: completed
    dependencies:
      - create-models-and-docx-io
  - id: create-template-analyzer
    content: 实现 template_analyzer.py：移植模板分析逻辑，识别KV/列表/混合表，提取表头和KV标签，用 [subagent:code-explorer] 验证复杂表格边界
    status: completed
    dependencies:
      - create-xml-utils
  - id: create-subtree-inserter
    content: 实现 xml_subtree_inserter.py：移植 fillTableFromSource/fillKeyValueTable/fillSignatureRowDirect/injectTextIntoCell/replaceMultiRunDate，用 lxml Element API 替代字符串操作
    status: completed
    dependencies:
      - create-xml-utils
  - id: create-filler-and-validator
    content: 实现 filler.py（填充协调器，占位符替换+KV填充+列表填充+签名填充）和 validator.py（格式校验）
    status: completed
    dependencies:
      - create-template-analyzer
      - create-subtree-inserter
  - id: create-cli-and-test
    content: 实现 cli.py（click CLI 入口）+ pyproject.toml + 用模板.docx 端到端测试验证生成报告可正常打开
    status: completed
    dependencies:
      - create-filler-and-validator
---

## 用户需求

将现有 TypeScript XML 处理逻辑用 Python + lxml 重写为独立模块，供外部调用，**并规划好项目结构便于后续封装为 CodeBuddy Skill**。

### 范围

- 重写 XML 处理核心：模板结构分析、数据填充、格式校验
- 生成独立 Python 包，可通过 CLI 或 Python API 调用
- **不包含** Web 服务层（Express/Multer）、文件上传/下载、任务管理

### 核心功能

1. 模板分析：解析 .docx 模板的 document.xml，识别表格类型（KV/列表/混合表）、提取表头列名、KV标签、签名行位置、占位符字段映射
2. 数据填充：占位符替换 + KV表填充 + 列表表填充 + 签名行填充，生成填充后的 .docx
3. 格式校验：对比填充前后表格结构一致性（标签配对、行数不变）
4. docx IO：ZipFile 解包/打包 .docx（替代 AdmZip）

### 技术改进

- 用 lxml.etree 替代手写正则的 extractTagContent，XML 解析更健壮
- 用 XPath 查询替代正则匹配表格/行/单元格
- 用 Element API 替代字符串拼接，自动处理 XML 转义
- 日期占位符匹配保留正则方案（模式匹配更灵活）

---

## 项目结构（Skill 封装就绪）

```
python_report_filler/                    # 独立 Python 包根目录
├── pyproject.toml                       # 包元数据 + 依赖 + CLI 入口点
├── README.md                            # 使用文档（API + CLI + 示例）
├── CODEBUDDY.md                         # CodeBuddy 代理指引
├── requirements.txt                     # 轻量依赖（pip install -r）
│
├── src/
│   └── report_filler/                   # 主包
│       ├── __init__.py                  # 版本号 + 公开 API 导出
│       ├── models.py                    # 数据模型（dataclass 替代 TypeScript interface）
│       ├── docx_io.py                   # ZipFile 解包/打包 + xml 读写
│       ├── xml_utils.py                 # XPath 工具集（替代 xml-utils.ts）
│       ├── template_analyzer.py         # 模板结构分析器
│       ├── xml_subtree_inserter.py      # XML 子树插入引擎（表格行填充）
│       ├── filler.py                    # 填充协调器（占位符 + KV + 列表 + 签名）
│       └── validator.py                 # 填充后格式校验
│
├── tests/                               # pytest 单元测试
│   ├── conftest.py                      # 共享 fixtures
│   ├── test_models.py                   # 数据模型测试
│   ├── test_docx_io.py                  # docx IO 测试
│   ├── test_xml_utils.py               # XML 工具测试
│   ├── test_template_analyzer.py       # 模板分析测试
│   ├── test_xml_subtree_inserter.py    # 子树插入测试
│   ├── test_filler.py                   # 端到端填充测试
│   ├── test_validator.py               # 校验测试
│   └── fixtures/                        # 测试用模板和数据
│       ├── sample_template.docx
│       ├── sample_data.json
│       └── sample_data.yaml
│
├── examples/                            # 使用示例
│   ├── simple_fill.py                   # 最简单的 Python API 调用
│   ├── batch_fill.py                    # 批量处理
│   └── template_analysis_only.py        # 仅分析模板
│
└── scripts/                             # Shell 封装（Skill 调用的入口）
    ├── setup.sh                         # Linux/macOS 一键安装
    ├── setup.bat                        # Windows 一键安装
    ├── analyze.sh                       # CLI 分析模板
    └── fill.sh                          # CLI 填充报告
```

### 关键设计：三层调用接口（Skill 友好）

| 层次 | 入口 | 用途 |
| --- | --- | --- |
| **Python API** | `from report_filler import ReportFiller` | 被其他 Python 代码直接调用，返回结构化结果 |
| **CLI** | `report-filler analyze/fill`（click） | 终端直接使用，JSON/stdout 输出 |
| **Shell Wrapper** | `scripts/fill.sh template.docx data.json` | Skill 自动发现 + 无 Python 环境感知 |


### pyproject.toml 关键配置

```
[project]
name = "report-filler"
version = "1.0.0"
description = "年度检查报告自动填充 - XML 处理核心"
requires-python = ">=3.10"
dependencies = [
    "lxml>=5.0",
    "click>=8.0",
    "pyyaml>=6.0",
]

[project.scripts]
report-filler = "report_filler.cli:main"

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-cov"]

[tool.setuptools.package-dir]
"" = "src"
```

### Skill 封装路径（后续）

当本包稳定后，封装为 CodeBuddy Skill 只需增加 `skill.yaml`：

```
name: report-filler
version: "1.0"
description: 年度检查报告自动填充
entry:
  cli: report-filler
  scripts:
    - scripts/fill.sh
    - scripts/analyze.sh
  setup: scripts/setup.sh
skills:
  - id: fill-report
    description: 用数据填充报告模板
    command: scripts/fill.sh --template {{template}} --data {{data}} --output {{output}}
  - id: analyze-template
    description: 分析报告模板结构
    command: scripts/analyze.sh --template {{template}}
```

---

## Tech Stack

| 组件 | 选型 | 理由 |
| --- | --- | --- |
| XML 解析 | **lxml** | 最快的 Python XML 库，XPath 支持，自动转义 |
| CLI 框架 | **click** | 轻量、装饰器风格、自动生成 --help |
| 数据模型 | **dataclasses** | 标准库，类型提示友好，替代 TS interface |
| YAML 解析 | **PyYAML** | 业界标准 |
| 打包 | **pyproject.toml + setuptools** | PEP 621 标准 |
| 测试 | **pytest** | 参数化测试、fixtures、覆盖率 |
| DOCX 辅助 | **python-docx** | 仅用于辅助场景（如读取样式），主力用 lxml |


## Implementation Approach

### 核心架构决策：lxml Element Tree vs 字符串操作

现有 TypeScript 方案的核心缺陷是**全程基于字符串正则操作 XML**，导致：

- `extractTagContent` 手写嵌套计数器容易出 bug
- 字符串拼接生成 XML 需要手动转义（曾导致 Word 打不开）
- gridSpan/vMerge 处理依赖正则匹配，脆弱且难维护

Python 版用 lxml.etree 的 DOM 树操作彻底解决：

- `tree.xpath('//w:tbl', namespaces=NSMAP)` 直接获取表格列表
- `cell.find('.//w:t', NSMAP)` 直接定位文本节点
- `element.text = new_text` 自动转义，无需手动 escapeXml
- `lxml.etree.tostring()` 序列化保证 XML 合法性

### 关键技术映射

| TypeScript 正则方案 | Python lxml 方案 |
| --- | --- |
| `extractTagContent(xml, pos, 'w:tbl')` | `tree.xpath('//w:tbl')` |
| `/<w:tc[ >]/g` 匹配单元格 | `row.findall('.//w:tc', NSMAP)` |
| `/<w:t\b[^>]*>(.*?)<\/w:t>/g` 提取文本 | `cell.findall('.//w:t', NSMAP)` + `.text` |
| `cell.replace(/(<w:t...>)(.*?)(<\/w:t>)/, ...)` | `wt.text = new_text` |
| `/<w:gridSpan\s+w:val="(\d+)"/` | `cell.get(qn('w:gridSpan'))` 或 XPath `@w:val` |
| `/<w:vMerge\s*\/>/` | `cell.find('.//w:vMerge', NSMAP)` + `.get(qn('w:val'))` |
| 字符串拼接 `<w:tc>...<w:t>text</w:t>...` | `lxml.etree.SubElement()` 创建节点 |


### 保留正则的场景

- 占位符模式匹配（`XXXXX-XXXX-XXXX-202X` 等固定模式）
- 日期占位符替换（`20\dX年\d{1,2}月\d{1,2}日` 等灵活模式）
- 多 run 日期序列检测（跨 `<w:t>` 的日期片段拼接验证）

### 数据流

```
template.docx
    ↓ DocxIO.unpack()
lxml ElementTree (document.xml)
    ↓ TemplateAnalyzer.analyze()
TemplateStructure (sections, tables, kvKeys, signaturePositions)
    ↓ ReportFiller.fill(unified_data)
填充后的 ElementTree
    ↓ Validator.validate()
校验结果 (passed, errors, warnings)
    ↓ DocxIO.pack()
output.docx
```

### 模块依赖图

```
                    ┌──────────────┐
                    │  models.py   │  (所有模块共享的数据模型)
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                 ▼
   ┌────────────┐  ┌──────────────┐  ┌──────────────┐
   │ docx_io.py │  │ xml_utils.py │  │  cli.py      │
   │(解包/打包) │  │(XPath工具集) │  │(CLI入口)     │
   └─────┬──────┘  └──────┬───────┘  └──────┬───────┘
         │                │                  │
         └────────┬───────┘                  │
                  ▼                          │
        ┌─────────────────┐                  │
        │template_analyzer│◄─────────────────┤
        │  (模板分析)     │                  │
        └────────┬────────┘                  │
                 │                           │
        ┌────────┴────────┐                  │
        ▼                 ▼                  │
  ┌──────────────┐ ┌─────────────┐           │
  │filler.py     │ │validator.py │◄──────────┤
  │(填充协调器)  │─│(格式校验)   │           │
  └──────┬───────┘ └─────────────┘           │
         │                                    │
         ▼                                    │
  ┌───────────────────┐                       │
  │xml_subtree_inserter│◄─────────────────────┘
  │(子树插入引擎)     │
  └───────────────────┘
```

### 各模块接口契约

#### `models.py` — 数据模型（零依赖，被所有模块引用）

```python
@dataclass
class BasicInfo: ...       # 对应 TS BasicInfo
@dataclass
class KeyValuePair: ...    # { key, value }
@dataclass
class DataTable: ...       # { table_type, headers, rows: List[Dict] }
@dataclass
class SectionData: ...     # { id, title, kv_pairs, tables, signature, ... }
@dataclass
class UnifiedReportData: ... # { basic_info, sections: List[SectionData] }
@dataclass
class TemplateStructure: ... # { sections: List[TemplateSection] }
@dataclass
class FillResult: ...      # { success, output_path, stats, warnings, validation }
```

#### `docx_io.py` — 仅依赖 stdlib `zipfile` + `pathlib`

```python
class DocxIO:
    @staticmethod
    def unpack(docx_path: str, output_dir: str) -> Path          # → document.xml 所在目录
    @staticmethod
    def pack(input_dir: str, output_path: str) -> str              # → 输出 .docx 路径
    @staticmethod
    def read_xml(docx_dir: str) -> tuple[etree._Element, str]      # → (root, raw_xml)
    @staticmethod
    def write_xml(tree: etree._Element, output_dir: str) -> None
```

#### `xml_utils.py` — 依赖 lxml

```python
WORDML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NSMAP = {"w": WORDML_NS}

def all_tables(tree: etree._Element) -> List[etree._Element]
def table_rows(table: etree._Element) -> List[etree._Element]
def row_cells(row: etree._Element) -> List[etree._Element]
def cell_texts(cell: etree._Element) -> List[str]          # 提取所有 <w:t> 文本
def cell_merged_text(cell: etree._Element) -> str           # 拼接所有 <w:t> 为一个字符串
def cell_gridspan(cell: etree._Element) -> int
def is_vmerge_continue(cell: etree._Element) -> bool
def is_vmerge_restart(cell: etree._Element) -> bool
def analyze_row_cells(row: etree._Element) -> RowCellInfo   # 分析行类型
def inject_text_into_cell(cell: etree._Element, text: str) -> bool
def clone_table_row(row: etree._Element) -> etree._Element
```

#### `template_analyzer.py` — 依赖 xml_utils + models

```python
class TemplateAnalyzer:
    def __init__(self, tree: etree._Element):
        ...
    def analyze(self) -> TemplateStructure:
        """主入口：分析整个模板结构"""
```

#### `filler.py` — 依赖所有下层模块

```python
class ReportFiller:
    def __init__(self, template_path: str):
        ...
    def fill(self, data: UnifiedReportData, output_path: str) -> FillResult:
        """主入口：填充数据到模板并输出 .docx"""
    def analyze_template(self) -> TemplateStructure:
        """仅分析模板结构"""
    def validate(self) -> ValidationResult:
        """仅校验已填充的文档"""
```

#### `cli.py` — 依赖 click + 上层模块

```python
@click.group()
def main(): ...

@main.command()
@click.option("--template", required=True)
def analyze(template): ...

@main.command()
@click.option("--template", required=True)
@click.option("--data", required=True)
@click.option("--output", default="output.docx")
def fill(template, data, output): ...

@main.command()
@click.option("--template", required=True)
@click.option("--data", required=True)
def validate(template, data): ...
```

---

## Implementation Notes

### 性能考虑

- lxml 解析 1MB+ 的 document.xml 约 50ms，远快于正则方案
- XPath 查询比正则匹配更高效（编译后复用）
- 填充时直接操作 DOM 节点，避免反复序列化/反序列化
- 填充完成后一次性 `tostring()` 序列化

### 向后兼容

- CLI 接口与现有 Node.js API 行为对齐（输入/输出格式一致）
- 数据模型字段名与 TypeScript interface 一一对应（snake_case 转 camelCase 需注意）
- 校验规则和错误消息格式保持一致

### 日志

- 使用 Python logging 模块
- INFO 级别记录填充进度，WARN 记录跳过的表格，ERROR 记录校验失败
- 通过 `getLogger("report_filler")` 命名，外部可配置 handler

### Blast Radius Control

- 独立目录 `python_report_filler/`，不修改现有 `server/` 代码
- 两套系统可并行运行，逐步验证迁移
- 通过 `examples/` 中的脚本验证端到端正确性

## Agent Extensions

### Skill

- **docx**
- Purpose: 在 docx_io.py 实现中参考 docx skill 的 unpack/pack 工具链，确保 Python 版 docx 解包/打包与现有方案兼容
- Expected outcome: docx 解包/打包功能正确，生成的 .docx 文件能被 Word 正常打开

### SubAgent

- **code-explorer**
- Purpose: 在实现前深入探索现有 TypeScript 代码中 fillTableFromSource、fillKeyValueTable、fillSignatureRowDirect 等复杂方法的完整逻辑边界
- Expected outcome: 确保所有边界条件（gridSpan/vMerge/空单元格/自闭合标签）在 Python 版中被正确处理