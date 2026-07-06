---
name: show-table-previews-in-frontend
overview: 修复前端数据预览：上传 .rj 文件后在预览区展示每个列表类表格的表头+完整数据行，同时移除调试用 console.log，优化展示样式。
todos:
  - id: update-type-comment
    content: 更新 TablePreview.sampleRows 类型注释为"所有数据行"
    status: pending
  - id: return-all-rows
    content: 修改 statements-parser 返回所有行数据，精简诊断日志
    status: pending
  - id: clean-console-logs
    content: 清理 upload.js 和 preview.js 中的调试 console.log
    status: pending
  - id: full-table-render
    content: 修改 preview.js：渲染完整表格数据，增加折叠/展开交互
    status: pending
    dependencies:
      - return-all-rows
---

## 用户需求

用户上传 .rj 知识图谱文件后，希望在前端预览区看到每个列表类表格的**完整表头+所有数据行**，以表格形式展示。当前只展示了前3行样本数据，且前端有调试 console.log 需清理。

## 核心改动

1. 后端返回所有行数据，不再截断为前3行
2. 前端移除调试代码，展示完整表格数据
3. 表格数据量大时支持折叠/展开，避免页面过长

## 修改文件清单

共 4 个文件需修改，3 个后端 + 1 个前端。

### 1. `server/src/types/index.ts` — 类型注释更新

- 第 234 行 `TablePreview.sampleRows` 注释从"样本行（前3行）"改为"所有数据行"

### 2. `server/src/services/statements-parser.service.ts` — 返回全部行

- 第 204-210 行：将 `for (let i = 0; i < Math.min(3, records.length)` 改为遍历所有记录 `for (let i = 0; i < records.length`
- 同步精简第 182-201 行的诊断日志：保留一条汇总日志 `[章节 X] 实体类型: N条记录`，移除逐条属性打印

### 3. `public/js/upload.js` — 清理调试代码

- 删除第 150-151 行的两个 console.log

### 4. `public/js/preview.js` — 清理调试 + 完整展示 + 折叠交互

- 删除第 50-52 行的两个 console.log
- 第 56-83 行表格渲染：将 `sampleRows` 改为渲染全部行
- 移除第 75 行的"还有 N 行"截断提示
- 新增折叠/展开交互：表格数据行超过 10 行时默认折叠（仅显示前 10 行），提供"展开全部"按钮
- 展开/收起通过 JS 切换 CSS class 实现，无需额外请求

## 实现细节

### 折叠交互方案

- 每个 `.table-mini tbody` 中，前 10 行始终可见
- 第 11 行起包裹在 `<tr class="collapsible-rows hidden">` 中
- 在表格卡片底部渲染一个 `展开全部 N 行` 按钮
- 点击按钮切换 `hidden` class 并更新按钮文案

### 性能考虑

- 后端遍历所有记录构建 `sampleRows`，复杂度 O(n)，每条记录调用 `buildRecordCells`
- `.rj` 文件通常包含数百条记录，JSON 序列化后约 50-200KB，在可接受范围内
- 前端渲染使用 innerHTML 一次性构建，避免逐行 DOM 操作