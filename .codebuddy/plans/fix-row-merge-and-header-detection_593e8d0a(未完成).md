---
name: fix-row-merge-and-header-detection
overview: 修复三组填充问题：(1) 克隆行vMerge清理不完整导致第二行单元格合并；(2) 模板分析器多行表头检测阈值过严导致3-1表头识别缺失；(3) 列名提取不完整导致3-2部分列数据缺失。
todos:
  - id: fix-vmerge-regex
    content: 修复 cleanVMergeFromRow 正则，匹配所有 vMerge 自闭合变体
    status: pending
  - id: fix-header-threshold
    content: 放宽 isSecondMergeTitle 阈值从60%到至少1个gridSpan≥2
    status: pending
  - id: verify-compile
    content: 编译验证 TypeScript 无错误
    status: pending
    dependencies:
      - fix-vmerge-regex
      - fix-header-threshold
  - id: verify-fill
    content: 验证三组问题修复效果：第二行不合并、3-1表头完整、3-2列数据写入
    status: pending
    dependencies:
      - verify-compile
---

## 用户需求

用户报告了三组报告填充问题，要求先分析根因再修复：

### 问题1：第二行数据单元格合并（5个表格）

**(2-1) 管道位置与走向检查报告、(2-3) 管道沿线防护带检查报告、(2-4) 跨越段检查报告、(2-6) 水工保护设施检查报告、(6-1) 壁厚测定报告**

- 第一组样例数据填写正确
- 第二组样例数据填写错误，错误地将单元格进行了垂直合并

### 问题2：(3-1) 表头识别缺失

**埋地管道外防腐层质量检测报告表格**

- 第2、3行为列表表头
- 表头识别有缺失
- 其中第2行"检测指标(三者选其一)"为合并单元格（gridSpan）

### 问题3：(3-2) 部分列样例数据缺失

**埋地管道外防腐层漏点检测报告表格**

- "漏点情况描述"和"漏点维修记录"列对应的样例数据没有写入

## 根因分析结论

### 问题1根因：`cleanVMergeFromRow` 正则不完整

- **位置**：`xml-subtree-inserter.service.ts` 第354-358行
- 当源数据行数超过模板数据行数时，通过 `cleanVMergeFromRow` 克隆模板第一数据行
- 该函数仅匹配 `<w:vMerge w:val="restart"/>` 和 `<w:vMerge />`（需空格），**遗漏了** `<w:vMerge/>`（无空格）、`<w:vMerge w:val="continue"/>` 等变体
- 克隆行中残留的 vMerge 标记导致第二行与第一行发生垂直合并

### 问题2根因：`isSecondMergeTitle` 阈值过严

- **位置**：`template-analyzer.service.ts` 第113行
- 三层表头检测要求 Row1 有 ≥60% 的单元格含 gridSpan≥2 才判定为合并子标题行
- 3-1表 Row1 有4个物理单元格，仅1个含 gridSpan（"检测指标" gridSpan=3），`1 < ceil(4×0.6)=3` → 未识别为合并标题行
- 导致使用 Row1 展开表头（"检测指标"重复3次）而非 Row2 真正列名（"电流mA"等）

### 问题3根因：与问题2同一根因

- 3-2表的多行表头同样因 `isSecondMergeTitle` 阈值过严未被正确识别
- 列名提取不全 → 样例数据缺少对应列 → 填充时无数据写入

## 技术栈

- 后端：Node.js + TypeScript (Express)，XML 正则操作
- 前端：纯 HTML/CSS/JS
- 模板处理：OOXML (WordprocessingML) XML 直接操作

## 实现方案

### 修复1：完善 `cleanVMergeFromRow` 正则（问题1）

**文件**：`server/src/services/xml-subtree-inserter.service.ts` 第354-358行

**当前代码**：

```typescript
private cleanVMergeFromRow(rowXml: string): string {
    return rowXml
      .replace(/<w:vMerge\s+w:val="restart"\s*\/>/g, '')
      .replace(/<w:vMerge\s+\/>/g, '');
}
```

**修复方案**：用单个通配正则匹配所有 vMerge 自闭合标签（含 restart、continue、无 val 属性、有/无空格）：

```typescript
private cleanVMergeFromRow(rowXml: string): string {
    return rowXml.replace(/<w:vMerge\b[^>]*\/>/g, '');
}
```

**原理**：`<w:vMerge\b` 匹配 `vMerge` 标签开头（`\b` 防止匹配 `vMergeVal` 等非标签），`[^>]*` 匹配任意属性（`w:val="restart"`、`w:val="continue"` 或无属性），`\/>` 匹配自闭合结尾。一个正则覆盖所有变体。

### 修复2：放宽 `isSecondMergeTitle` 阈值（问题2和问题3）

**文件**：`server/src/services/template-analyzer.service.ts` 第113行

**当前代码**：

```typescript
const isSecondMergeTitle = secondTcCount >= 2 
    && secondGridSpanGt1 >= Math.ceil(secondTcCount * 0.6);
```

**修复方案**：将阈值从 60% 降低为"至少1个单元格含 gridSpan≥2"：

```typescript
const isSecondMergeTitle = secondTcCount >= 2 && secondGridSpanGt1 >= 1;
```

**原理**：三层表头中 Row1 只要有任一单元格跨列合并（gridSpan≥2），就说明它是分组标题行（如"检测指标(三者选其一)" gridSpan=3 覆盖"电流/电位/保护电位"三列），Row2 才是真正的列名行。60% 阈值对"1个大合并格 + 多个普通格"的场景过严。

### 修复3：验证 `fillTableFromSource` 表头检测兼容性

**文件**：`server/src/services/xml-subtree-inserter.service.ts` 第83-126行

经分析，`fillTableFromSource` 的表头检测逻辑（第一循环 + 第二循环扩展）已能正确处理3-1表结构：

- Row0（标题1-2格）→ 第一循环始终纳入
- Row1（4格含gridSpan）→ 第一循环break，第二循环 `4 > 2` 纳入
- Row2（6格列名行）→ 第二循环 `6 > 4` 纳入

无需修改，但需在修复后验证。

## 实现备注

- **性能**：正则替换是 O(n) 操作，修改不影响性能
- **日志**：已有 `logger.info` 记录三层表头检测结果，修复后日志会正确输出 Row2 列名行信息
- **影响范围**：
- 修复1影响所有通过克隆生成第二行及后续数据行的表格（5+个表格）
- 修复2影响所有三层表头表格（3-1、3-2等），不影响双层和单层表头
- 不涉及 API 接口变更，不涉及前端修改
- **回归风险**：
- 修复1：移除所有 vMerge 是安全操作，克隆行不应有任何 vMerge
- 修复2：降低阈值可能使更多 Row1 被判定为合并标题行，但后续有 `thirdHeaders.length >= 3` 校验保护

## 目录结构

```
server/src/services/
├── xml-subtree-inserter.service.ts  # [MODIFY] 第354-358行 cleanVMergeFromRow 正则完善
└── template-analyzer.service.ts     # [MODIFY] 第113行 isSecondMergeTitle 阈值放宽
```