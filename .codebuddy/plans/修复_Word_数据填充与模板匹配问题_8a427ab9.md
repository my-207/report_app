---
name: 修复 Word 数据填充与模板匹配问题
overview: 在原有 DataRecord 修复基础上，扩展支持同时上传原始MD.docx作为补充数据源，修复键值对表格识别、表头匹配与表格内签名行填充，确保Word报告数据正确写入。
todos:
  - id: dual-source-ui
    content: 前端改造为支持同时上传 .rj 和 原始MD.docx，传递双 sessionId
    status: completed
  - id: api-dual-source
    content: 调整 /fill-by-copy 接收 sourceSessionId 与 rjSessionId 并合并 SourceAnalysis
    status: completed
    dependencies:
      - dual-source-ui
  - id: fix-datarecord
    content: 继续修复 statements-parser 中 DataRecord 非数字 seq 与多值 name 语义
    status: completed
  - id: header-matching
    content: 增强模板表头匹配，合并 Word XML 拆分文本
    status: completed
  - id: kv-recognition
    content: 修复 isKeyValueTable 识别与 fillKeyValueTable 填充，支持值列有内容的键值对表
    status: completed
  - id: signature-in-table
    content: 改为识别并填充表格内签名行模板单元格
    status: completed
    dependencies:
      - kv-recognition
  - id: verify-e2e
    content: Use [skill:systematic-debugging] 和 [skill:verification-before-completion] 验证双源 Word 输出
    status: completed
    dependencies:
      - api-dual-source
      - fix-datarecord
      - header-matching
      - kv-recognition
      - signature-in-table
---

## 产品概述

继续修复年度检查报告自动填充系统。用户在上一回合确认：允许前端同时上传 `.rj` 知识图谱和 `原始MD.docx` 作为补充源；`BasicInfo` 提取不到的字段暂时不写入；签名行改为直接填充表格内的签名行模板单元格。因此本次范围在原有 DataRecord 语义修复基础上，新增键值对表格识别修复、表格内签名行修复、模板表头匹配增强。

## 核心功能

- `.rj` 的 DataRecord 继续区分“序号/检测项目/检测值”语义，Section 1-1 等非数字 `seq` 场景生成正确表格预览。
- 前端支持同时上传 `.rj` 与 `原始MD.docx`，两者 sessionId 一并传给 `/fill-by-copy`。
- 键值对表格识别增强：源表格值列即使已有内容（如原始 MD 的管道参数表），也能被识别为键值对表并按 `标签 → 值` 填充。
- 签名行改为填充表格内签名行模板单元格：解析源签名行中的检测/校对/审核人名与日期，按列填入模板最后一行签名模板。
- 模板表头匹配增强：处理 Word XML 中表头文本被拆分为多个 `<w:t>` 的情况，降低匹配失败率。
- BasicInfo 获取不到的字段不写入，保留模板占位符原样。

## Tech Stack

- 后端：Node.js + TypeScript + Express
- 解析：自定义 JSON-LD 解析器（`statements-parser.service.ts`）
- 映射：集中式属性映射表（`rj-property-map.ts`）
- 填充：Word XML 直接操作（`filler.service.ts` / `xml-subtree-inserter.service.ts`）
- 前端：原生 HTML/CSS/JS

## Implementation Approach

### 总体策略

采用“双源互补”策略：`.rj` 负责列表型检测数据（如跨越、穿越、装置等），`原始MD.docx` 负责键值对表格和签名行数据。`filler.service.ts` 的 `fillBySubtreeCopy` 同时接收 `sourceSessionId` 和 `rjSessionId`，合并两个 `SourceAnalysis` 后按章节匹配模板。

### 关键决策

1. **双源合并**：`/fill-by-copy` 允许同时传入 `sourceSessionId` 和 `rjSessionId`。合并时以 `.rj` 的章节表格为主，原始 MD 的键值对表和签名数据作为补充；同一章节同时存在两种源时，优先用 MD 的键值对/签名数据。
2. **键值对识别增强**：放宽 `isKeyValueTable` 判断——只要第一行满足“标签列有文本且结构为标签/值交替”即视为键值对表，不再要求值列为空；填充时只覆盖空值单元格，保留模板已有非空内容。
3. **表格内签名行填充**：移除 `insertTextAfterAnchor` 段落插入逻辑，改为在 `fillTableFromSource` 中识别最后一行签名行，将源签名行的人名/日期按列填充到模板签名行单元格。
4. **表头匹配增强**：提取模板表头时先合并同一单元格内的连续 `<w:t>` 文本，再与源表头做模糊匹配，解决“序/号”“检查结/果”被拆分导致的匹配失败。
5. **BasicInfo 安全回退**：`replacePlaceholders` 中字段为空时直接跳过，保留模板占位符，不强行写入不完整信息。

## Implementation Notes

- 性能：合并双源分析时采用 Map 去重，避免 O(n²) 比较；签名行填充只扫描每个表格的最后一行。
- 日志：继续使用现有 `logger.ts`，记录每个章节使用的数据源和匹配得分。
- 兼容性：保留原有 JSON/YAML 填充路径和单源 `/fill-by-copy` 调用方式；`sourceSessionId` 与 `rjSessionId` 均为可选，但至少提供一个。
- 回归控制：修改 `isKeyValueTable` 后可能影响列表型表格判断，需用原始 MD 和 `.rj` 同时验证。

## Architecture Design

```
User Browser
    │
    ├── 上传模板 .docx ──→ templateService
    ├── 上传 .rj ───────→ statementsParser
    └── 上传 原始MD.docx ─→ chapterExtractor
                          │
                          ▼
                fillerService.fillBySubtreeCopy
                  ┌─────────────────────┐
                  │  合并 sourceAnalysis  │
                  │  .rj 列表型数据      │
                  │  MD 键值对/签名数据   │
                  └─────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   占位符替换      键值对表格填充      列表型表格填充
   (BasicInfo)     (标签→值)          (表头→列)
                          │
                          ▼
                   表格内签名行填充
                          │
                          ▼
                  docxService.pack
```

## Directory Structure

```
报告生成/
└── server/
    ├── src/
    │   ├── routes/
    │   │   └── api.ts                              # [MODIFY] /fill-by-copy 同时接收 sourceSessionId 和 rjSessionId
    │   ├── services/
    │   │   ├── statements-parser.service.ts        # [MODIFY] 继续修复 DataRecord 语义
    │   │   ├── filler.service.ts                 # [MODIFY] 双源合并、表头匹配增强
    │   │   └── xml-subtree-inserter.service.ts   # [MODIFY] 键值对识别增强、表格内签名行填充
    │   ├── utils/
    │   │   └── rj-property-map.ts                # [MODIFY] detectItem 映射
    │   └── tests/
    │       └── statements-parser.test.ts          # [MODIFY/NEW] 覆盖 DataRecord 与键值对场景
    └── package.json                                # [MODIFY] 如新增测试脚本
└── public/
    ├── index.html                                  # [MODIFY] 双源上传 UI
    ├── js/
    │   ├── upload.js                               # [MODIFY] 允许同时上传 .rj 和 原始MD.docx
    │   ├── api.js                                  # [MODIFY] executeFillByCopy 支持双 sessionId
    │   └── main.js                                 # [MODIFY] 双源状态判断
    └── css/
        └── style.css                               # [MODIFY] 双源上传样式
```

## Agent Extensions

- **systematic-debugging**
- Purpose: 在修改键值对识别、签名行、表头匹配前，复现 Word 输出中数据未写入的具体位置；修改后验证每个修复点是否生效。
- Expected outcome: 明确问题链路（源解析 → 表头匹配 → 表格/签名填充 → Word 输出），确认修复后键值对表格、列表型表格、签名行均有正确数据。
- **verification-before-completion**
- Purpose: 在宣称修复完成前运行单元测试与端到端验证（双源上传 `.rj` + `原始MD.docx` 并检查生成 Word）。
- Expected outcome: 提供测试通过日志与生成文档检查证据，避免回归。