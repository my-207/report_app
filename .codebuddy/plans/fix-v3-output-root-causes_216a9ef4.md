---
name: fix-v3-output-root-causes
overview: 修复V3输出文档中占位符全部残留（mapTo前缀不匹配bug）+ 10个表格未被填充（section覆盖不全）两大核心问题
todos:
  - id: fix-mapto-mismatch
    content: 修复 template-analyzer.service.ts generateSampleData() 中 fieldNames.has() 的 key 与 mapTo 前缀不匹配 bug
    status: completed
  - id: fix-date-range-regex
    content: 修复 template.service.ts findPlaceholders() 中日期范围正则无法匹配模板实际格式(202X年6月-202X年7月)
    status: completed
  - id: add-fallback-sections
    content: 为 generateSampleData() 添加兜底逻辑：确保每个模板 tableIndex 都有对应的 data section 覆盖
    status: completed
    dependencies:
      - fix-mapto-mismatch
  - id: compile-and-verify
    content: 编译验证(tsc --noEmit) 并清理临时分析文件
    status: completed
    dependencies:
      - fix-date-range-regex
      - add-fallback-sections
---

## 产品概述

修复 V3 输出报告中占位符全部残留（报告编号、公司名、设备名等 11/13 处未替换）以及 10 个表格完全未被填充的两大核心问题。下载一致性已验证正常（MD5 一致），问题出在填充引擎的数据生成和匹配环节。

## 核心功能

### P0 — 修复 generateSampleData() 中 mapTo 字符串前缀不匹配（导致 basicInfo 全空）

- `template.service.ts` 的 `findPlaceholders()` 定义的 `mapTo` 值为 `"basicInfo.reportNumber"` 等带前缀格式
- `template-analyzer.service.ts` 的 `generateSampleData()` 用 `fieldNames.has("reportNumber")` 无前缀格式检查 → **9 个字段全部不匹配** → 全部赋值为空字符串
- 需要统一两边的 key 命名：修改 `generateSampleData()` 中的 `fieldNames.has(...)` 参数，使其与 `mapTo` 值一致

### P0子项 — 日期范围正则与签名日期映射修正

- 模板实际文本为 `202X年6月-202X年7月`（具体月份非 X），当前正则 `/20\dX年[\s\u3000]*X月...` 无法匹配
- 签名日期 `mapTo="signatureDate"` 但代码检查 `inspectorDate/checkerDate/reviewerDate`
- 需要补充新的日期范围匹配模式 + 修正字段映射关系

### P1 — 分析并修复 10 个 IDENTICAL 表格未被填充的原因

- 表格 [0,1,3,15,17,18,19,20,24,25,27] 输出与模板 100% 相同
- 可能原因：这些 tableIndex 未包含在 generateSampleData 的 sections 输出中
- 需要在 generateSampleData 中确保每个模板表格都有对应的 data section 覆盖

### 验证

- 编译通过 `tsc --noEmit`
- 运行端到端填充测试确认占位符被替换、所有表格均有数据写入

## 技术栈

- TypeScript (Node.js 后端)
- Express.js API 服务
- Word XML 直接操作（docx unpack/pack 工具链）

## 实现方案

### 方案核心：统一 mapTo 字段命名 + 补全缺失的 section 覆盖

采用"修改 generateSampleData 使之适配 findPlaceholders 已有 mapTo 值"的策略，而非反过来改 mapTo（因为 mapTo 还被其他地方引用）。

### 实现细节

#### 修复 1：`template-analyzer.service.ts` generateSampleData() — fieldNames 匹配修正

**文件**: `server/src/services/template-analyzer.service.ts` 第 277-293 行

将：

```typescript
const basicInfo: BasicInfo = {
  reportNumber: fieldNames.has("reportNumber") ? "GGA-2025-03001-2025" : "",
  companyName: fieldNames.has("companyName") ? "华东特种设备检测有限公司" : "",
  deviceName: fieldNames.has("deviceName") ? "工业管道GC2-DN200-01段" : "",
  reportTypePrefix: fieldNames.has("reportTypePrefix") ? "GGA" : "",
  inspectionStartDate: fieldNames.has("inspectionStartDate") ? "2025年6月" : "",
  inspectionEndDate: fieldNames.has("inspectionEndDate") ? "2025年7月" : "",
  inspectorDate: fieldNames.has("inspectorDate") ? "2025年7月15日" : "",
  checkerDate: fieldNames.has("checkerDate") ? "2025年7月15日" : "",
  reviewerDate: fieldNames.has("reviewerDate") ? "2025年7月18日" : "",
};
```

改为使用带前缀的完整 mapTo 值进行匹配，同时处理 `inspectionDateRange` 和 `signatureDate` 这两个特殊映射：

```typescript
// 统一用 mapTo 原值做 key 查找，避免字符串不一致
const hasField = (key: string) => fieldNames.has(key);
const basicInfo: BasicInfo = {
  reportNumber:     hasField("basicInfo.reportNumber") ? "GGA-2025-03001-2025" : "",
  companyName:      hasField("basicInfo.companyName") ? "华东特种设备检测有限公司" : "",
  deviceName:       hasField("basicInfo.deviceName") ? "工业管道GC2-DN200-01段" : "",
  reportTypePrefix: hasField("basicInfo.reportTypePrefix") ? "GGA" : "",
  // 日期范围: findPlaceholders 用 "inspectionDateRange" 作为 mapTo
  inspectionStartDate: hasField("inspectionDateRange") ? "2025年6月" : "",
  inspectionEndDate:   hasField("inspectionDateRange") ? "2025年7月" : "",
  // 签名日期: findPlaceholders 用 "signatureDate"/"signatureDateAlt"
  inspectorDate: hasField("signatureDate") || hasField("signatureDateAlt") ? "2025年7月15日" : "",
  checkerDate:   hasField("signatureDate") || hasField("signatureDateAlt") ? "2025年7月16日" : "",
  reviewerDate:  hasField("signatureDate") || hasField("signatureDateAlt") ? "2025年7月18日" : "",
};
```

#### 修复 2：`template.service.ts` findPlaceholders() — 补充日期范围匹配模式

**文件**: `server/src/services/template.service.ts` 第 102-110 行

在 patterns 数组中新增一个针对模板中实际出现的 `202X年X月-202X年X月` 格式的模式（注意模板中是具体数字如 `202X年6月-202X年7月`）：

实际上分析发现模板文本是 `检   验   日   期：202X年6月-202X年7月`，其中月份是数字不是 X。当前正则要求 `X月` 所以匹配失败。需要增加一个更宽松的模式：

```typescript
// 新增: 日期范围宽松模式（匹配 202X年N月-202X年N月 格式，其中 N 为任意数字）
{ regex: /20\dX年[\s\u3000]*\d+月[\s\u3000]*-[\s\u3000]*20\dX年[\s\u3000]*\d+月/g,
  mapTo: "inspectionDateRange" },
```

注意此模式应放在现有 `inspectionDateRange` 正则**之后**（因为现有模式优先级更高，先精确后宽松）。或者直接修改现有正则使 `\d+` 替代 `X`。

**最佳方案**：直接修改第 107 行现有正则，将 `X月` 改为 `\d+?月`（非贪婪数字+月）：

```typescript
// 修改前:
{ regex: /20\dX年[\s\u3000]*X月[\s\u3000]*-[\s\u3000]*20\dX年[\s\u3000]*X月/g, mapTo: "inspectionDateRange" },
// 修改后:
{ regex: /20\dX年[\s\u3000]*\w+?月[\s\u3000]*-[\s\u3000]*20\dX年[\s\u3000]*\w+?月/g, mapTo: "inspectionDateRange" },
```

#### 修复 3：P1 — 确保 generateSampleData 为每个模板表格产出对应 section

**文件**: `server/src/services/template-analyzer.service.ts` generateSampleData()

当前逻辑只遍历 `structure.sections` 中 `sectionId !== "_placeholders"` 的 section 来生成数据。需要检查是否有表格未被任何 section 覆盖。

关键改动点：在第 296-298 行的遍历之后，添加一个**兜底逻辑**，扫描哪些 tableIndex 没有被覆盖，并为它们创建默认数据 section：

```typescript
// 收集已被分配的 tableIndex
const coveredIndices = new Set<number>();
for (const sec of sections) {
  for (const tbl of sec.tables) {
    if (tbl.tableIndex !== undefined) coveredIndices.add(tbl.tableIndex);
  }
  if (sec.signaturePosition?.tableIndex !== undefined) {
    coveredIndices.add(sec.signaturePosition.tableIndex);
  }
}

// 兜底: 为未覆盖的表格创建默认 section（至少填入一行样例数据）
const totalTables = structure.sections
  .filter(s => s.sectionId !== "_placeholders")
  .reduce((max, s) => Math.max(max, ...s.tables.map(t => t.tableIndex ?? 0)), -1);
for (let i = 0; i <= totalTables; i++) {
  if (!coveredIndices.has(i)) {
    sections.push(createFallbackSection(i));
  }
}
```

## 架构设计

### 数据流修正前后对比

```
修正前:
  template.findPlaceholders() → mapTo="basicInfo.reportNumber"
  ↓
  analyzer.generateSampleData() → fieldNames.has("reportNumber") ❌ 不匹配
  ↓
  basicInfo 全空 → replacePlaceholders() 跳过全部替换
  ↓
  输出文档: 13 处占位符残留, 10 个表未触碰

修正后:
  template.findPlaceholders() → mapTo="basicInfo.reportNumber"
  ↓
  analyzer.generateSampleData() → fieldNames.has("basicInfo.reportNumber") ✅ 匹配
  ↓
  basicInfo 有值 → replacePlaceholders() 成功替换 11/13 处
  ↓
  兜底 section 覆盖剩余 10 个表格 → 所有 28 表均有数据
```

## 目录结构

```
server/src/
├── services/
│   ├── template-analyzer.service.ts  # [MODIFY] 修复1: generateSampleData fieldNames 匹配; 修复3: 兜底 section 覆盖
│   └── template.service.ts           # [MODIFY] 修复2: findPlaceholders 日期范围正则放宽
└── utils/
    └── template-generator.ts         # [NO CHANGE] 此文件的模板数据不受影响（独立于运行时分析）
```

## 关键注意事项

- **向后兼容**: `findPlaceholders` 的 `mapTo` 值不能改（可能被其他消费者依赖），只修改 `generateSampleData` 的消费侧
- **正则安全性**: 日期范围正则放宽时必须确保不会误匹配真实数据内容（如已有日期值）
- **性能影响**: 兜底 section 创建是 O(n) 扫描，n=28 可忽略不计
- **日志输出**: 修复后在 `generateSampleData` 中增加一条 logger.info 输出 basicInfo 中有多少个字段成功赋值

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 在执行修复前验证 10 个 IDENTICAL 表格的具体 tableIndex 分布情况，确认哪些 tableIndex 未被 structure.sections 覆盖
- Expected output: 列出每个未被覆盖的 tableIndex 及其对应的模板表格内容摘要