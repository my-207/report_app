---
name: statements-rj-parser
overview: 新增 statements.rj（RDF/JSON-LD 知识图谱）解析服务，将知识图谱数据转换为 SourceAnalysis 格式，支持作为子树复制填充的数据源。同时新增 API 端点支持上传 .rj 文件。
todos:
  - id: create-parser
    content: 新建 statements-parser.service.ts：实现 RDF 解析、实体分类、模拟 XML 表格生成、SourceAnalysis 组装
    status: pending
  - id: add-api-route
    content: 修改 api.ts：新增 POST /api/upload-rj 接口，multer 增加 .rj 支持
    status: pending
    dependencies:
      - create-parser
  - id: modify-fill-route
    content: 修改 POST /api/fill-by-copy：支持 rjSessionId 参数，兼容 basicInfo 补充
    status: pending
    dependencies:
      - add-api-route
  - id: update-config
    content: 修改 config.ts：supportedFormats.data 增加 .rj
    status: pending
  - id: verify-compile
    content: 编译验证，确保零 TypeScript 错误
    status: pending
    dependencies:
      - create-parser
      - add-api-route
      - modify-fill-route
      - update-config
---

## 用户需求

支持 `statements.rj` 文件（RDF/JSON-LD 知识图谱格式）作为数据源，替代现有 .docx 源文档，进行子树复制填充。用户上传 .rj 文件后，系统自动解析 RDF 实体，转换为 `SourceAnalysis` 格式，复用现有的 `fillBySubtreeCopy` 填充流程。

## 核心功能

1. **上传 .rj 文件**：新增 `POST /api/upload-rj` 接口，接收 .rj 文件并解析为 `SourceAnalysis`
2. **RDF 解析器**：新增 `StatementsParser` 服务，解析 JSON-LD 顶层实体，按 `belongsToSection` 分组，将各类型记录转为模拟 XML 表格片段
3. **BasicInfo 补充**：API 接收可选的 `basicInfo` 参数，补充 statements.rj 中缺失的报告编号、公司名、日期等字段
4. **复用填充流程**：解析结果为 `SourceAnalysis` 格式，直接通过现有 `fillBySubtreeCopy` 进行表格匹配和填充

## 技术栈

- 语言：TypeScript（Node.js）
- 框架：Express.js
- 数据解析：JSON.parse（.rj 文件本质是 JSON）

## 实现方案

### 整体架构

```
statements.rj 上传
       ↓
StatementsParser.parse(rjContent, basicInfoOverride)
       ↓  解析 JSON-LD 顶层对象
       ↓  遍历所有实体，按类型分类
       ↓  按 belongsToSection 分组记录
       ↓  每种记录类型 → 生成模拟 XML 表格 (<w:tbl>)
       ↓  组装 Chapter 列表 + BasicInfo
       ↓
SourceAnalysis { chapters, basicInfo }
       ↓
fillBySubtreeCopy() — 复用现有流程
```

### 核心新增文件

`server/src/services/statements-parser.service.ts` — RDF 解析器

#### 解析策略

1. `JSON.parse` 加载整个 .rj 文件
2. 遍历顶层对象的所有 key（实体 URI），按 `rdf:type` 分类：

- `ReportSection` / `ConclusionSection` → 章节定义
- 数据记录类型 → 按 `belongsToSection` 分组

3. 每个数据记录类型 → `buildTableXml(entityType, records)` 生成模拟 `<w:tbl>` XML
4. 组装 `SourceAnalysis`：每个 Section → 一个 `Chapter`（包含该章节下所有数据记录的模拟表格）

#### 模拟 XML 表格生成

由于 `fillBySubtreeCopy` 中的 `findMatchingTemplateTable` 通过提取 `<w:t>` 文本匹配表头，需要为每种记录类型生成包含表头行和数据行的 `<w:tbl>` XML 片段：

```xml
<w:tbl>
  <w:tr><w:tc><w:p><w:r><w:t>序号</w:t></w:r></w:p></w:tc><w:tc>...</w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc>...</w:tc></w:tr>
</w:tbl>
```

每种实体类型的表头映射：

| 实体类型 | 表头列 |
| --- | --- |
| CrossingRecord | 序号, 河流名称, 穿越类型, 埋深, 起始位置, 结束位置, 长度, 所属管道 |
| GroundDevice | 序号, 装置类型, 位置, 名称, 埋深, 所属管道 |
| ConclusionRecord | 序号, 位置, 所属管道 |
| AnomalyRecord | 序号, 所属管道 |
| DataRecord | 序号, 字段名, 字段值, 位置, 所属管道 |
| OverheadRecord | 序号, 跨越方式, 名称, 位置, 所属管道 |
| PipelineComponent | 序号, 名称, 位置, 所属管道 |


### 修改文件

1. **`server/src/routes/api.ts`**

- 新增 `POST /api/upload-rj` 接口：接收 `.rj` 文件上传，调用 `StatementsParser.parse()` 生成 `SourceAnalysis`，缓存到 `sourceSessions`
- 修改 `POST /api/fill-by-copy`：支持 `rjSessionId` 参数（与 `sourceSessionId` 二选一）
- multer 文件过滤器增加 `.rj` 扩展名

2. **`server/src/config.ts`**

- `employee.supportedFormats.data` 增加 `.rj`

### 不变的部分

- `filler.service.ts` 的 `fillBySubtreeCopy` 完全不变
- `xml-subtree-inserter.service.ts` 不变
- 模板处理流程不变
- 前端逻辑不变（后续可选增加前端支持）

### 实现细节

#### RDF 属性值提取

所有 RDF 属性值都是数组格式 `[{ "value": "xxx", "type": "literal"|"uri" }]`，需要统一提取：

```typescript
private getValue(prop: any[] | undefined): string {
  if (!prop || prop.length === 0) return "";
  return String(prop[0].value || "");
}
```

#### DataRecord 的 name 数组处理

DataRecord 的 `name` 属性是多值数组，通常包含管道名和字段标签（如 `["港清复线", "管道材质", "3PE"]`），需要解析为键值对或列数据。

#### BasicInfo 合并

API 接收 `basicInfo` JSON 对象，与从 .rj 提取的信息合并。缺失字段用空字符串（filler 会跳过空值保留模板原样）。

#### 签名行

statements.rj 中无签名信息，`Chapter.signatureText` 返回空字符串，模板签名行保留原样。

### 目录结构

```
server/src/
├── services/
│   └── statements-parser.service.ts  # [NEW] RDF 解析器，将 .rj 转为 SourceAnalysis
├── routes/
│   └── api.ts                        # [MODIFY] 新增 /upload-rj，修改 /fill-by-copy
├── config.ts                         # [MODIFY] supportedFormats 增加 .rj
└── types/
    └── index.ts                      # 不变
```