---
name: mdx-to-template-xml-copy
overview: 将系统改为从原始MD.docx提取XML子树，通过直接XML复制粘贴方式填入模板文件，实现报告自动生成。
todos:
  - id: extract-xml-utils
    content: 提取 xml-utils.ts 公共工具模块：将 extractTagContent 从 filler.service.ts 和 template.service.ts 提升为公共方法，新增 findAllTags、findChapterBoundaries 等工具函数
    status: completed
  - id: build-chapter-extractor
    content: 使用 [subagent:code-explorer] 分析原始MD.docx 和模板的章节结构，实现 chapter-extractor.service.ts：按章节编号切分 XML，提取每个章节的段落和表格子树
    status: completed
    dependencies:
      - extract-xml-utils
  - id: build-subtree-inserter
    content: 实现 xml-subtree-inserter.service.ts：XML 子树插入引擎，支持按锚点定位插入段落、替换表格内容、在指定位置插入文本
    status: completed
    dependencies:
      - extract-xml-utils
  - id: update-filler-service
    content: 重构 filler.service.ts：删除重复的 extractTagContent，新增 fillBySubtreeCopy 核心流程方法，保留 replacePlaceholders 用于 basicInfo 占位符
    status: completed
    dependencies:
      - extract-xml-utils
      - build-subtree-inserter
  - id: update-types-and-routes
    content: 更新 types/index.ts 新增 Chapter、SourceAnalysis、SubtreeCopyStats 类型；更新 routes/api.ts 新增 /api/upload-source 和 /api/fill-by-copy 端点
    status: completed
    dependencies:
      - build-chapter-extractor
      - build-subtree-inserter
  - id: update-template-service
    content: 重构 template.service.ts：删除重复的 extractTagContent，改为使用 xml-utils，新增对源 docx 的 session 管理方法
    status: completed
    dependencies:
      - extract-xml-utils
  - id: integration-test
    content: 端到端集成测试：上传模板和原始MD.docx，执行 fill-by-copy，验证生成的报告结构完整、表格数据正确、占位符已替换
    status: completed
    dependencies:
      - update-filler-service
      - update-types-and-routes
      - update-template-service
---

## 用户需求

将系统从"JSON 数据填充"模式改为"从原始 MD.docx 提取数据，直接 XML 复制粘贴填入模板"模式。原始 MD.docx 是一份已填充完成的管道检测报告合集，包含 11 条管线、20+ 个章节、30,868 个文本节点和大量表格数据。模板是空白年度检查报告，含占位符和空表格。

## 产品概述

用户上传两个文件：**模板.docx**（空白模板含占位符）和 **原始MD.docx**（已填充完成的报告）。系统自动从原始报告中提取对应章节的 XML 子树（文本段落和表格），通过表头匹配定位模板中的目标位置，将 XML 子树直接复制粘贴到模板 XML 中，生成完整的报告供下载。

## 核心功能

- **双文件上传**：同时上传模板 docx 和原始数据 docx，系统分别解压到独立 session
- **章节识别**：从原始 MD.docx 中识别章节边界（通过文本标记如 "2-2 （2-2）地面装置检查报告"），提取每个章节的 XML 子树
- **模板锚点定位**：在模板 XML 中，通过文本占位符和表头匹配定位每个章节对应的插入位置
- **XML 子树复制粘贴**：将原始报告中的 `<w:p>`（段落）和 `<w:tbl>`（表格）XML 子树直接插入模板对应位置
- **占位符替换**：对于 basicInfo（报告编号、公司名、设备名、日期、签名），从原始报告的文本中提取并替换模板占位符
- **结果下载**：打包生成新 docx 供下载

## 技术栈

- 后端：Node.js 18+ + Express 4 + TypeScript（复用现有架构）
- docx 操作：adm-zip（已有，纯 Node.js 解压/打包）
- XML 操作：字符串级别子树提取/插入（复用并增强现有 extractTagContent）
- 前端：纯 HTML/CSS/JS（已有，仅需微调上传区）

## 架构设计

### 整体数据流

```mermaid
flowchart TD
    A[用户上传] -->|模板.docx| B[模板 Session]
    A -->|原始MD.docx| C[源数据 Session]
    B --> D[模板 XML]
    C --> E[源数据 XML]
    
    E --> F[章节切分器<br/>chapter-splitter]
    F --> G[章节列表<br/>Chapter\[\]]
    
    G --> H{章节类型}
    H -->|文本段落| I[提取 w:p 子树]
    H -->|表格数据| J[提取 w:tbl 子树]
    
    D --> K[模板分析器<br/>template.service]
    K --> L[占位符位置 + 表格锚点]
    
    I --> M[XML 子树插入引擎<br/>xml-subtree-inserter]
    J --> M
    L --> M
    
    M --> N[修改后模板 XML]
    N --> O[打包 → 下载]
```

### 核心模块设计

#### 1. 新增：`server/src/services/chapter-extractor.service.ts`

章节切分器。从原始 MD.docx 的 `document.xml` 中识别章节边界标记（如 `（2-2）地面装置检查报告`），将文档切分为章节列表。

```typescript
interface Chapter {
  id: string;           // 如 "2-2"
  title: string;        // 如 "（2-2）地面装置检查报告"
  xmlContent: string;   // 该章节的完整 XML 片段
  startIndex: number;   // 在 document.xml 中的起始位置
  endIndex: number;     // 结束位置
  paragraphs: string[]; // 段落 w:p 子树列表
  tables: string[];     // 表格 w:tbl 子树列表
  signatureText: string; // 签名行文本
}
```

**切分策略**：按章节编号模式 `（\d+-\d+）` 扫描 `<w:t>` 文本节点，以每个章节标题为边界切分 XML。

#### 2. 新增：`server/src/services/xml-subtree-inserter.service.ts`

XML 子树插入引擎。负责将源 XML 子树插入到目标 XML 的指定位置。

**核心方法**：

- `insertParagraphAfterAnchor(targetXml, anchorPattern, sourceParagraphs)` — 在锚点段落之后插入源段落
- `insertTableAfterAnchor(targetXml, anchorPattern, sourceTables)` — 在锚点表格之后插入源表格行
- `replaceTableContent(targetXml, targetTableIndex, sourceTable)` — 用源表格的完整内容替换模板表格
- `insertTextBeforeAnchor(targetXml, anchorPattern, text)` — 在锚点前插入文本（如结论）

#### 3. 新增：`server/src/utils/xml-utils.ts`

共享 XML 工具。从 `filler.service.ts` 和 `template.service.ts` 中提取 `extractTagContent` 到公共工具模块，消除重复代码。同时增加：

```typescript
// 现有方法（提升为 public）
extractTagContent(xml, startPos, tagName): string | null

// 新增方法
findAllTags(xml, tagName): Array<{ index: number; content: string }>
extractTextBetween(xml, startPattern, endPattern): string
findChapterBoundaries(xml): Array<{ id, title, startIndex }>
```

#### 4. 修改：`server/src/services/filler.service.ts`

- 删除私有 `extractTagContent`，改用 `xml-utils.ts`
- 删除 `getTemplateRow` 中的重复实现
- 新增 `fillBySubtreeCopy` 方法作为核心流程编排
- 保留 `replacePlaceholders` 用于 basicInfo 占位符替换

#### 5. 修改：`server/src/routes/api.ts`

新增两个端点：

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| `POST` | `/api/upload-source` | 上传原始 MD.docx，解压并分析章节结构 |
| `POST` | `/api/fill-by-copy` | 执行 XML 子树复制填充（需 templateSessionId + sourceSessionId） |


#### 6. 修改：`server/src/types/index.ts`

新增类型：

```typescript
interface Chapter { id, title, xmlContent, startIndex, endIndex, paragraphs, tables, signatureText }
interface SourceAnalysis { chapters: Chapter[]; basicInfo: BasicInfo; totalChapters: number }
interface SubtreeCopyStats { chaptersCopied: number; paragraphsInserted: number; tablesFilled: number; placeholdersReplaced: number }
```

### 章节映射策略

| 原始MD章节 | 模板中对应区域 | 复制方式 |
| --- | --- | --- |
| 1-1 原始资料审查 | 第1章 原始资料审查 | 复制签名行文本到模板签名位置 |
| 2-2 地面装置检查 | 第2章 地面装置检查表 | 复制整个 `<w:tbl>` 子树替换模板空表格 |
| 3-1 防腐层质量检测 | 第3章 防腐层检测表 | 同上 |
| 5-7 管地电位测试 | 第5章 电位测试表 | 同上 |
| ... | ... | ... |


### 占位符替换映射

| 模板占位符 | 数据来源（从原始MD提取） |
| --- | --- |
| `XXXXX-XXXX-XXXX-202X` | 从原始MD文本第一行提取报告编号 |
| `XXXXXXX公司` | 从原始MD文本提取使用单位 |
| `XXXXXXXXXXXX` | 从原始MD文本提取设备/管线名称 |
| `202X年6月-202X年7月` | 从签名行提取最早和最晚日期 |
| `202X年X月XX日` | 从签名行提取检测/校对/审核日期 |


## Agent Extensions

### Skill

- **docx**
- 用途：提供 Word 文档 XML 结构分析的参考知识，验证 unpack/pack 后的 XML 结构完整性
- 预期结果：确认 XML 子树复制后的文档结构符合 OOXML 规范，可被 Word/WPS 正常打开

### SubAgent

- **code-explorer**
- 用途：深度分析原始 MD.docx 和模板的 XML 文档树，精确定位章节边界标记和表格锚点
- 预期结果：输出章节边界 XML 偏移量表、模板表格锚点索引表、占位符精确位置清单