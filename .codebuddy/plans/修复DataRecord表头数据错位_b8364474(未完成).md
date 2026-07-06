---
name: 修复DataRecord表头数据错位
overview: 修复 .rj 解析后 DataRecord 表格首列显示字段名（如“绝热层厚度（mm）”）而非序号、表头与数据错位的问题。
todos:
  - id: inspect-datarecord
    content: 对比 Section_1-1 与 Section_3-1 的 DataRecord 样本，确认 seq/name 语义差异
    status: pending
  - id: add-detectItem
    content: 在 rj-property-map.ts 中增加 detectItem 属性与 DataRecord 列顺序
    status: pending
    dependencies:
      - inspect-datarecord
  - id: refactor-parser
    content: 重构 statements-parser.service.ts 中 DataRecord 分支，支持非数字 seq 与多值 name
    status: pending
    dependencies:
      - add-detectItem
  - id: add-tests
    content: 编写 statements-parser 单元测试，覆盖 DataRecord 正常/异常 seq 场景
    status: pending
    dependencies:
      - refactor-parser
  - id: verify-e2e
    content: Use [skill:systematic-debugging] 和 [skill:verification-before-completion] 验证前端预览与 Word 输出
    status: pending
    dependencies:
      - add-tests
---

## 产品概述

继续修复年度检查报告自动填充系统中 `.rj` 知识图谱解析后 DataRecord 表格的错位问题。上一回合已修复 CSS 导致表格概览空白的问题，但 Section 1-1 的 DataRecord 首列被填入字段名（如“绝热层厚度（mm）”），而不是序号，导致表头与数据不匹配。

## 核心功能

- 正确区分 `seq` 的“序号”与“检测项目名”两种语义：非数字 `seq` 时自动生成序号并另存为 `detectItem`。
- 修正 `DataRecord` 的 `name` 数组解析：多值场景不再简单拆为 `detectValue`/`detectDate`，而是按行数据语义合并处理。
- 保持 Section 3-1 等 `seq` 为数字的正常 DataRecord 解析不变。
- 不改动 CrossingRecord / GroundDevice / PipelineComponent / OverheadRecord 等已稳定的类型。
- 修复后前端表格预览与 Word 子树复制填充结果一致。

## 技术栈

- 后端：Node.js + TypeScript + Express
- 解析：自定义 JSON-LD 解析器（`statements-parser.service.ts`）
- 映射：集中式属性映射表（`rj-property-map.ts`）
- 填充：Word XML 直接操作（`filler.service.ts` / `xml-subtree-inserter.service.ts`）

## 实现方案

1. 在 `rj-property-map.ts` 中新增 `detectItem` 属性，中文标签为“检测项目”，并把它加入 `RJ_ENTITY_COLUMNS.DataRecord` 的推荐列顺序（`seq` 之后）。
2. 在 `statements-parser.service.ts` 的 `extractRecordValues` 中重构 `DataRecord` 分支：

- 读取原始 `seq` 值；若符合 `/^\d+$/` 则保留为“序号”。
- 若 `seq` 不是数字，则使用 `buildTable` 生成的行索引作为序号，并把原始 `seq` 写入 `detectItem`。
- 区分“正常行”与“矩阵/多值行”：
    - 正常行（`seq` 为数字且 `name` 为 1-2 个值）：维持现有 `detectValue`/`detectDate` 拆分。
    - 多值行（`seq` 非数字或 `name` 超过 2 个值）：将 `name` 数组按 `, ` 合并为 `detectValue`，避免表头数量与模板列数不匹配；同时抑制与 `name` 内容重复的 `sourceReport` 列。

3. 在 `buildTable` 中统一序号生成策略：当 `seq` 缺失或非数字时，使用 `i + 1` 作为序号。
4. 可选：在章节分组阶段过滤明显噪声记录（`name` 等于章节标题且 `sourceReport` 为管道名）。
5. 为 `statements-parser.service.ts` 增加/补充单元测试，覆盖 `DataRecord` 的数字 `seq`、非数字 `seq`、多值 `name` 三种情况。
6. 使用 `statements.rj` 调用 `/api/upload-rj` 验证前端预览，并通过 `/fill-by-copy` 验证生成的 Word 文档。

## 实施要点

- 不引入 `docx-js` 重建方案，继续基于 XML 直接操作。
- 非数字检测仅使用整数正则表示，避免把浮点/单位字符串误判为序号。
- 对 `name` 多值合并时保留空格，防止预览单元格换行异常。
- 不修改其他实体类型的解析逻辑，确保回退安全。
- 变更后 `tablePreviews` 的 `headers` / `sampleRows` 自动同步，无需改动前端渲染逻辑。

## 架构设计

仅改动数据解析层（`statements-parser.service.ts` + `rj-property-map.ts`），其余服务（`filler.service.ts`、`docx.service.ts`）保持无感。`Chapter.tables` 的 XML 结构仍由 `buildTable` 统一输出。

## 目录结构

```
报告生成/
└── server/
    ├── src/
    │   ├── services/
    │   │   └── statements-parser.service.ts  # [MODIFY] 重构 DataRecord 解析逻辑
    │   ├── utils/
    │   │   └── rj-property-map.ts          # [MODIFY] 增加 detectItem 属性与列顺序
    │   └── tests/
    │       └── statements-parser.test.ts # [NEW] DataRecord 解析单元测试
    └── ...
```

## Agent Extensions

- **systematic-debugging**
- Purpose: 在修改前复现并确认 DataRecord 首列被字段名占位的根因，修改后验证修复。
- Expected outcome: 明确问题链路（`seq` 解析 → 表头生成 → 前端预览），确认修复后首列显示序号。
- **verification-before-completion**
- Purpose: 在宣称修复完成前运行单元测试与端到端验证（上传 `statements.rj` 并检查预览 / Word 输出）。
- Expected outcome: 提供测试通过与截图/日志证据，避免回归。