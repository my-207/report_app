---
name: frontend-subtree-copy-adapter
overview: 适配前端页面，将上传区从"JSON/YAML数据"改为"原始MD.docx源数据"，新增子树复制填充流程，适配SourceAnalysis预览格式。
todos:
  - id: update-api-js
    content: 更新 api.js：新增 uploadSource(file)、executeFillByCopy(templateSessionId, sourceSessionId) 函数，移除 downloadTemplate 函数
    status: completed
  - id: update-upload-js
    content: 更新 upload.js：dataFile/dataPreview 重命名为 sourceFile/sourceAnalysis，新增 sourceSessionId，handleDataFile 改为 handleSourceFile 接受 .docx，removeData 改为 removeSource
    status: completed
  - id: update-preview-js
    content: 更新 preview.js：renderPreview 改为展示 SourceAnalysis（左栏 basicInfo 字段 + 右栏章节统计概览和章节 ID 列表）
    status: completed
  - id: update-main-js
    content: 更新 main.js：startFill 改为调用 executeFillByCopy，移除 readFileAsText，showResult 增加 subtreeStats 5 项统计展示
    status: completed
    dependencies:
      - update-api-js
      - update-upload-js
  - id: update-index-html
    content: 更新 index.html：右侧卡片改为原始报告上传（标题/描述/图标/accept），导航栏移除 JSON/YAML 模板下载按钮，步骤条文字微调
    status: completed
    dependencies:
      - update-upload-js
---

## 用户需求

将前端页面从"JSON/YAML 数据填充模式"适配为"子树复制模式"。核心变化：右侧上传卡片从上传 JSON/YAML 数据文件改为上传原始报告 .docx 文件；填充逻辑从传数据内容改为传两个 sessionId；预览和结果展示适配新的数据结构。

## 核心功能变更

- **上传区改造**：右侧卡片标题、描述、图标、accept 属性从 JSON/YAML 改为 .docx 原始报告
- **状态管理**：`dataFile`/`dataPreview` 替换为 `sourceFile`/`sourceAnalysis`，新增 `sourceSessionId`
- **上传流程**：`handleDataFile` 改为 `handleSourceFile`，调用 `POST /api/upload-source`
- **预览改造**：从展示 BasicInfo 字段 + 表格 chips 改为展示 SourceAnalysis（章节列表 + basicInfo + 统计概览）
- **填充改造**：不再读取文件内容，改为传 `{ templateSessionId, sourceSessionId }` 调用 `POST /api/fill-by-copy`
- **结果展示**：新增 `chaptersCopied`、`paragraphsInserted` 统计项
- **API 层**：新增 `uploadSource(file)`、`executeFillByCopy(templateSessionId, sourceSessionId)` 函数
- **导航栏**：移除 JSON/YAML 模板下载按钮（子树复制模式下不需要数据模板）

## 技术方案

### 改动范围

本次改动仅限于前端纯静态文件（HTML/CSS/JS），不涉及后端。后端 API 已就绪。

### 文件改动清单

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `public/index.html` | 修改 | 右侧卡片内容、步骤条文字、导航栏按钮、JS 引用 |
| `public/js/api.js` | 修改 | 新增 uploadSource、executeFillByCopy，移除 downloadTemplate 相关 |
| `public/js/upload.js` | 修改 | 全局状态变量重命名，handleDataFile→handleSourceFile，接受 .docx |
| `public/js/main.js` | 修改 | startFill 改为调用 executeFillByCopy，showResult 增加 subtreeStats 展示 |
| `public/js/preview.js` | 修改 | renderPreview 改为展示 SourceAnalysis（章节列表 + basicInfo） |
| `public/css/style.css` | 不改 | 现有样式体系完全复用 |


### 数据流变化

```
旧流程: 用户上传 template.docx + data.json
         → upload.js 保存 templateSessionId + dataFile
         → main.js 读取 dataFile 文本内容
         → api.js 调用 POST /api/fill { sessionId, dataContent, dataFormat }

新流程: 用户上传 template.docx + source.docx
         → upload.js 保存 templateSessionId + sourceSessionId + sourceAnalysis
         → main.js 直接使用两个 sessionId
         → api.js 调用 POST /api/fill-by-copy { templateSessionId, sourceSessionId }
```

### 预览数据结构适配

旧 `DataPreview`:

```
{ basicInfo: {...}, tables: [{ tableName, headerCount, rowCount, headers, sampleRows }] }
```

新 `SourceAnalysis` 返回:

```
{ totalChapters, totalTables, basicInfo: {...}, chapterIds: ["1-1", "2-2", ...] }
```

预览区改为两栏：左栏显示 basicInfo（复用现有字段展示），右栏显示统计概览（章节数、表格数、章节列表）。

### 结果数据结构适配

旧 `FillResult.stats`:

```
{ placeholdersReplaced, tablesFilled, rowsInserted }
```

新返回值增加 `subtreeStats`:

```
{ fillResult: { stats: {...} }, subtreeStats: { chaptersCopied, paragraphsInserted, tablesFilled, placeholdersReplaced, rowsInserted } }
```

结果区展示 `subtreeStats` 的 5 项统计。