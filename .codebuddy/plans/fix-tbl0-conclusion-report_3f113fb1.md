---
name: fix-tbl0-conclusion-report
overview: 确认 table_0 年度检查结论报告目录未填充的根因：isKeyValueTable 误判为 KV 表导致走错填充路径。代码修复已完成且编译通过，需要重启服务器并重新生成验证。
design:
  architecture:
    framework: react
    component: tdesign
todos:
  - id: scan-all-tables
    content: 用离线脚本扫描全部28个模板表格的分类结果，确认无其他表格受同类误判影响
    status: completed
  - id: offline-e2e-verify
    content: 编写并运行完整离线端到端测试：模拟 analyze→generateSampleData→fillBySubtreeCopyV2→pack 全流程验证 table_0 填充效果
    status: completed
    dependencies:
      - scan-all-tables
  - id: verify-output-report
    content: 对比新生成的输出报告中 table_0 的18个单元格与原始模板的差异，确认至少 Row[1]-Row[2] 有样例数据写入
    status: completed
    dependencies:
      - offline-e2e-verify
  - id: cleanup-analysis-files
    content: 清理 _analysis/ 目录下的临时诊断脚本文件(d*.js, e2e_*.js, check_*.js, trace_*.js, test_*.js)
    status: completed
    dependencies:
      - verify-output-report
---

## 产品概述

修复输出报告中"XXXXXXXX年度检查结论报告"表格(table_0)未写入样例数据的问题。该表格为目录型表格（4列：序号|检验项目|页码|附页、附图），因被错误分类为键值对表导致填充引擎走错了路径。

## 核心功能

### 问题根因

`isKeyValueTable()` 函数的 **Strategy 2** 将 table_0 的首行误判为 KV 对：

- 表头行: `序号(2字符)` → `检验项目(4字符)`, `页码(2字符)` → `附页、附图(5字符)`
- 满足 "标签短、值长" 条件 → 误判为 KV 表 → generateSampleData 走 KV 分支只产 2 个 kvPairs
- fillBySubtreeCopyV2 检测 kvPairs.length > 0 → 进入 fillKeyValueTable 路径而非 fillTableFromSource
- fillKeyValueTable 无法正确匹配 4 列 LIST 结构 → 0 行填充

### 修复目标

1. **table_0 (年度检查结论报告目录)** 正确分类为 LIST[4列]，生成完整的列表样例数据并成功写入模板
2. **所有其他可能受影响的目录型/列表型表格** 不再发生同类误判
3. 端到端验证：重新生成报告后确认 table_0 有数据填充，占位符被替换

## 技术栈

- TypeScript (Node.js 后端, Express.js)
- Word XML 直接操作 (docx unpack/pack 工具链)
- 无前端变更

## 实现方案

### 方案概览

代码修复已完成并通过编译。核心修改在 `isKeyValueTable()` 函数中增加**列表型表头前置排除检测**：

```
原有流程:
  isKeyValueTable() → Strategy 2 匹配"标签短值长" → 返回 true (误判)

修复后流程:
  isKeyValueTable() → 首行≥3列? → 含列表关键词(序号/检验项目/页码)? 
    → 是 → 直接返回 false (LIST表)
    → 否 → 继续原有 Strategy 2 判断
```

### 已完成的修改

| 文件 | 行号 | 修改内容 | 状态 |
| --- | --- | --- | --- |
| `server/src/utils/xml-utils.ts` | 192-216 | 新增 LIST_HEADER_KEYWORDS 常量 + 首行>=3列时的列表表头排除逻辑 | 已编译通过 |
| `server/src/services/template-analyzer.service.ts` | 285-294 | generateSampleData() 使用带前缀的 mapTo 值匹配 basicInfo 字段 | 已编译通过 |
| `server/src/services/template.service.ts` | 107 | findPlaceholders() 日期范围正则放宽为 `[X\d]+?月` | 已编译通过 |
| `server/src/services/template-analyzer.service.ts` | 369-398 | 兜底 section 覆盖逻辑确保每个 tableIndex 都有数据 | 已存在 |


### 需要执行的验证步骤

由于服务器(PID 13068)运行旧版代码且用户拒绝终止进程，采用**离线端到端验证方案**——直接调用已编译的模块模拟完整填充链路，无需重启服务器。

本任务不涉及 UI 变更，仅涉及后端逻辑修复和验证。不需要设计部分。

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 扫描全部 28 个模板表格的分类结果(isKeyValueTable)，确认没有其他表格受到同样的误判影响
- Expected output: 列出每个 tableIndex 的分类结果(KV/LIST)、表头内容、是否含列表关键词