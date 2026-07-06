---
name: statements-rj-parser
overview: 新增 statements.rj（RDF/JSON-LD 知识图谱）解析服务，前后端完整支持：后端解析 .rj 文件转为 SourceAnalysis，前端增加 .rj 文件上传卡片、BasicInfo 补充表单和结果预览。
todos:
  - id: create-parser
    content: 新建 server/src/services/statements-parser.service.ts：RDF 解析、实体分类、模拟 XML 表格生成、SourceAnalysis 组装
    status: completed
  - id: backend-api-config
    content: 修改 api.ts（新增 /upload-rj、修改 /fill-by-copy 兼容 rjSessionId、multer 增加 .rj）+ config.ts（supportedFormats 增加 .rj）
    status: completed
    dependencies:
      - create-parser
  - id: frontend-html-css
    content: 修改 index.html（源文档卡片模式标签 + BasicInfo 补充表单）+ style.css（新增模式标签、表单、提示样式）
    status: completed
  - id: frontend-js
    content: 修改 upload.js（.rj 分支 + BasicInfo 收集）+ api.js（uploadRj）+ main.js（rjSessionId 兼容 + resetAll 清理）
    status: completed
    dependencies:
      - frontend-html-css
  - id: verify-compile
    content: 编译验证：npx tsc --noEmit 确保零 TypeScript 错误
    status: completed
    dependencies:
      - backend-api-config
      - frontend-js
---

## 产品概述

全栈实现 statements.rj（RDF/JSON-LD 知识图谱）作为数据源支持。后端新增 RDF 解析服务将知识图谱转换为 SourceAnalysis 格式并接入现有填充流程；前端新增 .rj 文件上传、数据源模式切换和 BasicInfo 补充表单。

## 核心功能

- **后端 RDF 解析**：解析 JSON-LD 知识图谱，按 Section 分组各类型记录，生成模拟 Word XML 表格片段
- **后端 API**：新增 /api/upload-rj 接口（接收 .rj 文件 + 可选 basicInfo），修改 /fill-by-copy 兼容 rjSessionId
- **前端模式切换**：源文档卡片顶部增加 .docx / .rj 两个模式标签，默认选中 .docx 保持向后兼容
- **前端 BasicInfo 补充**：上传 .rj 后自动展开折叠面板，提供 9 个可选字段的表单（报告编号、公司名、日期等）
- **前端填充流程**：提交任务时根据模式传 rjSessionId 或 sourceSessionId，复用现有 executeFillByCopy

## 技术栈

- 后端：Node.js + TypeScript + Express.js
- 前端：纯静态 HTML/CSS/JS（无框架）
- 数据解析：JSON.parse（.rj 文件本质是 JSON）

## 实现方案

### 后端架构

#### 1. 新增 statements-parser.service.ts

```
JSON.parse(rjContent) → 遍历顶层实体 → 按 rdf:type 分类
  ├── ReportSection → 章节定义 (annexNum → Chapter.id)
  ├── CrossingRecord → 按 belongsToSection 分组 → buildTableXml
  ├── GroundDevice → 同上
  ├── ConclusionRecord → 同上
  ├── AnomalyRecord → 同上
  ├── DataRecord → 同上（name 多值数组需特殊解析）
  ├── OverheadRecord → 同上
  └── PipelineComponent → 同上
      ↓
  SourceAnalysis { chapters[], basicInfo }
```

**关键方法**：

- `parse(rjContent: string, basicInfoOverride?: Partial<BasicInfo>): SourceAnalysis`
- `getValue(prop)`：提取 RDF 属性值数组的第一个 value
- `getEntityType(uri)`：从 URI 提取实体类型（如 `CrossingRecord`）
- `buildTableXml(entityType, records)`：生成含表头行和数据行的 `<w:tbl>` XML
- `buildDataRecordTable(records)`：DataRecord 特殊处理（name 数组解析为键值对）
- `buildWt(text)`：构建 `<w:t>` XML 片段
- `buildWtc(text)`：构建 `<w:tc>` XML 片段
- `buildWtr(cells)`：构建 `<w:tr>` XML 片段

**表头映射**：

| 实体类型 | 表头列 |
| --- | --- |
| CrossingRecord | 序号, 河流名称, 穿越类型, 埋深(m), 起始位置, 结束位置, 长度(m), 所属管道 |
| GroundDevice | 序号, 装置类型, 位置, 名称, 所属管道 |
| ConclusionRecord | 序号, 位置, 所属管道 |
| AnomalyRecord | 序号, 位置, 所属管道 |
| DataRecord | 序号, 字段名, 字段值, 所属管道 |
| OverheadRecord | 序号, 跨越方式, 名称, 位置, 所属管道 |
| PipelineComponent | 序号, 名称, 位置, 所属管道 |


#### 2. 修改 api.ts

- multer fileFilter 增加 `.rj`
- 新增 `POST /api/upload-rj`：接收 `rj` 文件 + 可选 `basicInfo` JSON 字段，调用 StatementsParser.parse()，缓存到 sourceSessions
- 修改 `POST /api/fill-by-copy`：优先使用 rjSessionId，否则使用 sourceSessionId；sourceSessions 的 value 类型增加 `rjAnalysis: SourceAnalysis`

#### 3. 修改 config.ts

- `employee.supportedFormats.data` 数组增加 `".rj"`

### 前端架构

#### 1. index.html 修改

**源文档卡片改造**（右卡片 #sourceCard）：

- 卡片顶部新增两个模式标签 `<div class="source-mode-tabs">`：
- `<button class="mode-tab active" data-mode="docx">.docx 原始报告</button>`
- `<button class="mode-tab" data-mode="rj">.rj 知识图谱</button>`
- 选中 .docx：dropzone 文字 "上传 .docx 格式的已填充报告"，input accept=".docx"
- 选中 .rj：dropzone 文字 "上传 .rj 知识图谱数据文件"，input accept=".rj"，显示提示 "数据来源：管道检测知识图谱系统"

**BasicInfo 补充表单**（新增 #rjBasicInfoSection）：

- 位于预览区上方、操作按钮区之前
- 折叠面板结构，默认 hidden
- 9 个输入字段：reportNumber、companyName、deviceName、reportTypePrefix、inspectionStartDate、inspectionEndDate、inspectorDate、checkerDate、reviewerDate
- "应用补充信息" 按钮触发 applyBasicInfo()

#### 2. upload.js 修改

- 全局状态增加 `isRjMode = false`、`rjSessionId = null`、`rjBasicInfo = {}`
- `initUpload()` 增加模式标签点击事件绑定
- `switchSourceMode(mode)`：切换模式标签样式、更新 dropzone 文字/accept、重置已上传状态
- `handleSourceFile(file)`：根据 isRjMode 分发到 handleDocxSource 或 handleRjFile
- `handleRjFile(file)`：收集当前 basicInfo → 调用 uploadRj(file, basicInfo)
- `collectBasicInfo()`：从表单读取 9 个字段值，返回 Partial<BasicInfo>
- `applyBasicInfo()`：收集表单 → 重新调用 uploadRj 更新 session
- `checkBothReady()`：.rj 模式只需 templateFile + rjSessionId 即视为就绪
- `removeSource()`：清理 rj 相关状态 + 隐藏补充表单

#### 3. api.js 修改

- 新增 `uploadRj(file, basicInfo)`：FormData 包含 file + basicInfo JSON 字符串字段

#### 4. main.js 修改

- `startFill()`：isRjMode 时传 `{ templateSessionId, rjSessionId }`，否则传 `{ templateSessionId, sourceSessionId }`
- `resetAll()`：清理 rjSessionId、isRjMode、rjBasicInfo，重置模式标签为 .docx

#### 5. style.css 新增样式

- `.source-mode-tabs`：flex 布局，圆角标签
- `.mode-tab`：默认灰色，active 状态蓝色高亮
- `.rj-basicinfo-form`：折叠面板，卡片样式
- `.rj-form-grid`：2 列网格布局
- `.rj-form-field`：label + input
- `.rj-upload-hint`：知识图谱提示文字

### 数据流

```
前端选择 .rj 模式 → 上传 .rj 文件
  ↓ 显示 BasicInfo 补充表单
前端填写补充信息 → 调用 POST /api/upload-rj
  ↓ 后端解析 RDF → SourceAnalysis → 缓存
前端 renderPreview(analysis)
  ↓ 点击提交任务
前端 POST /api/fill-by-copy { templateSessionId, rjSessionId }
  ↓ fillBySubtreeCopy() 复用现有流程
  ↓ 打包 docx → 返回下载 URL
前端显示结果 + 下载按钮
```

### 不变的部分

- filler.service.ts 的 fillBySubtreeCopy 完全不变
- xml-subtree-inserter.service.ts 不变
- 模板上传流程不变
- preview.js 的 renderPreview 不变
- 进度区和结果区不变