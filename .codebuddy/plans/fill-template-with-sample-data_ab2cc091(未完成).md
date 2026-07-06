---
name: fill-template-with-sample-data
overview: 新增 API 端点接受 UnifiedReportData JSON 直接调用 fillBySubtreeCopyV2 填充模板，前端新增「使用样例数据填充模板」按钮一键生成报告。
todos:
  - id: add-fill-endpoint
    content: 后端新增 POST /api/fill-with-data 端点，接收 { templateSessionId, unifiedData }，调用 fillBySubtreeCopyV2 填充后 pack 生成 docx，返回 downloadUrl
    status: pending
  - id: add-frontend-api
    content: 前端 api.js 新增 fillWithData() 函数，POST 到 /api/fill-with-data
    status: pending
  - id: add-sample-fill-func
    content: main.js 新增 startSampleFill() 函数：读取 cachedSampleData，调用 fillWithData，复用 setProgress/showResult 展示进度和结果
    status: pending
    dependencies:
      - add-frontend-api
  - id: add-fill-button
    content: index.html 模板结构区 ts-actions 内新增「使用样例数据填充」按钮，绑定 onclick="startSampleFill()"
    status: pending
  - id: verify-compile
    content: 编译验证 npx tsc --noEmit，确保零错误
    status: pending
    dependencies:
      - add-fill-endpoint
      - add-sample-fill-func
---

## 用户需求

在模板数据结构A展示区新增「使用样例数据填充」按钮，点击后将前端缓存的样例 JSON 数据（UnifiedReportData）发送至后端，调用已就绪的 `fillBySubtreeCopyV2` 方法完成模板填充，打包生成 Word 报告并返回下载链接。

## 核心功能

- **后端新增填充接口**：`POST /api/fill-with-data` 接收 `{ templateSessionId, unifiedData }`，调用 `fillBySubtreeCopyV2` 执行占位符替换+KV表填充+列表表填充，然后 `docxService.pack` 打包生成 .docx
- **前端填充触发**：模板数据结构A区新增「使用样例数据填充」按钮，点击后发送 `cachedSampleData` 到后端
- **填充进度与结果展示**：复用现有进度动画和结果展示区，显示统计信息（占位符替换数、表格填充数、数据行数）和下载按钮
- **按钮状态管理**：无样例数据时按钮禁用；填充进行中时按钮显示"处理中..."

## 技术方案

### 实现策略

新增一个简洁的 API 端点 `POST /api/fill-with-data`，参考现有 `fill-by-copy` 端点的打包输出模式（api.ts:328-333），将 `UnifiedReportData` 送入已就绪的 `fillBySubtreeCopyV2` 方法。前端新增 `fillWithData()` API 函数和 `startSampleFill()` 触发函数，复用现有的进度条和结果展示区。

### 关键设计决策

1. **新增独立端点而非扩展现有端点**：`/api/fill-with-data` 语义清晰，不干扰现有 `/api/fill` 和 `/api/fill-by-copy` 逻辑
2. **直接传递 UnifiedReportData JSON**：前端 `cachedSampleData` 已是完整格式，无需二次解析
3. **复用现有 UI 组件**：progressSection（进度动画）+ resultSection（结果展示）已在 HTML 中定义，`showResult()` 和 `setProgress()` 函数可直接复用
4. **输出文件命名**：使用 `basicInfo.reportNumber || '样例报告'` 作为文件名前缀

### 性能考量

- `fillBySubtreeCopyV2` 对 28 张表格+4 个占位符的处理时间预计在 2-5 秒内
- 后端仅做 XML 操作+打包，无额外 I/O

### 防回归

- 不修改 `fillerService`、`fillBySubtreeCopyV2`、现有 `/api/fill`、`/api/fill-by-copy`
- `renderTemplateStructure` 不受影响
- `cachedSampleData` 仅在点击按钮时读取，不影响现有数据流

## 架构设计

```mermaid
flowchart LR
    A[用户点击「使用样例数据填充」] --> B[POST /api/fill-with-data]
    B --> C[fillerService.fillBySubtreeCopyV2]
    C --> D[docxService.pack]
    D --> E[返回 downloadUrl]
    E --> F[前端展示结果 + 下载按钮]
```

## 目录结构

```
报告生成/
├── server/src/
│   └── routes/
│       └── api.ts                    # [MODIFY] 新增 POST /api/fill-with-data 端点
├── public/
│   ├── index.html                    # [MODIFY] ts-header 区内新增「使用样例数据填充」按钮
│   ├── js/
│   │   ├── api.js                    # [MODIFY] 新增 fillWithData() 函数
│   │   └── main.js                   # [MODIFY] 新增 startSampleFill() 函数
│   └── css/
│       └── style.css                 # [MODIFY] 新增 .btn-primary 主按钮样式（如尚无）
```

## 关键代码结构

### 后端端点 (api.ts)

```typescript
// POST /api/fill-with-data
// 请求体: { templateSessionId: string, unifiedData: UnifiedReportData }
// 流程:
//   1. 校验参数
//   2. 获取 templateEntry (含 unpackDir)
//   3. fillerService.fillBySubtreeCopyV2(templateSessionId, unifiedData)
//   4. docxService.pack(unpackDir, outputPath)
//   5. 返回 fillResult + subtreeStats
```

### 前端填充函数 (main.js)

```javascript
// startSampleFill()
//   1. 校验 cachedSampleData 和 templateSessionId
//   2. 显示 progressSection，调用 setProgress 动画
//   3. 调用 fillWithData(templateSessionId, cachedSampleData)
//   4. showResult() 展示统计和下载按钮
```

### 前端 API (api.js)

```javascript
// fillWithData(templateSessionId, unifiedData)
//   POST /api/fill-with-data
//   body: JSON.stringify({ templateSessionId, unifiedData })
```