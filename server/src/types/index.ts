// ============================================================
// 年度检查报告自动填充 - 类型定义
// ============================================================

// ---------- 数据模型 ----------

/** 基本信息 */
export interface BasicInfo {
  /** 报告编号，格式: XXXXX-XXXX-XXXX-20XX */
  reportNumber: string;
  /** 单位名称 */
  companyName: string;
  /** 设备名称 */
  deviceName: string;
  /** 报告类型前缀，如 "GGW" */
  reportTypePrefix: string;
  /** 检验起始日期，格式: YYYY年M月 */
  inspectionStartDate: string;
  /** 检验结束日期，格式: YYYY年M月 */
  inspectionEndDate: string;
  /** 检测人签名日期，格式: YYYY年M月DD日 */
  inspectorDate: string;
  /** 校对人签名日期 */
  checkerDate: string;
  /** 审核人签名日期 */
  reviewerDate: string;
}

/** 表格数据 */
export interface TableData {
  /** 表格名称 / Sheet 名称 */
  tableName: string;
  /** 列标题 */
  headers: string[];
  /** 数据行 */
  rows: string[][];
}

/** 完整报告数据 */
export interface ReportData {
  basicInfo: BasicInfo;
  tables: TableData[];
}

// ---------- 任务模型 ----------

/** 任务状态 */
export type TaskStatus = "pending" | "running" | "completed" | "failed";

/** 填充统计 */
export interface FillStats {
  placeholdersReplaced: number;
  tablesFilled: number;
  rowsInserted: number;
}

/** 校验结果 */
export interface ValidationInfo {
  /** 是否通过校验 */
  passed: boolean;
  /** 错误信息列表 */
  errors: string[];
  /** 警告信息列表 */
  warnings: string[];
}

/** 填充结果 */
export interface FillResult {
  success: boolean;
  outputFileName: string;
  downloadUrl: string;
  stats: FillStats;
  warnings: string[];
  error?: string;
  /** 格式校验结果（填充后生成） */
  validation?: ValidationInfo;
}

/** 任务输入信息 */
export interface TaskInput {
  templateName: string;
  dataFileName: string;
  recordCount: number;
}

/** 任务信息 */
export interface TaskInfo {
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  input?: TaskInput;
  result?: FillResult;
  error?: string;
  callbackUrl?: string;
}

/** 任务执行请求（来自数字员工管理系统） */
export interface TaskExecuteRequest {
  /** 模板文件的 Base64 编码或 URL */
  template?: string;
  /** 模板文件路径（如果已上传） */
  templatePath?: string;
  /** 数据内容（JSON 或 YAML 字符串） */
  data: string;
  /** 数据格式: json 或 yaml */
  dataFormat?: "json" | "yaml";
  /** 回调地址 */
  callbackUrl?: string;
}

// ---------- 数字员工纳管模型 ----------

/** 员工信息 */
export interface EmployeeInfo {
  employeeId: string;
  employeeName: string;
  version: string;
  capabilities: string[];
  supportedFormats: {
    templates: string[];
    data: string[];
  };
  callbackUrl?: string;
}

/** 健康状态 */
export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
  };
  activeTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
}

// ---------- 模板分析 ----------

/** 占位符位置信息 */
export interface PlaceholderLocation {
  /** 占位符模式 */
  pattern: string;
  /** 所在 XML 文件 */
  xmlFile: string;
  /** 实际匹配的完整文本 */
  matchedText: string;
  /** 替换映射 */
  mapTo: string;
}

/** 表头匹配信息 */
export interface TableHeaderMatch {
  /** 表格在 document.xml 中的索引 */
  tableIndex: number;
  /** 匹配到的表头 */
  headers: string[];
  /** 对应的数据表格名称 */
  tableName: string;
}

/** 模板分析结果 */
export interface TemplateAnalysis {
  /** 占位符清单 */
  placeholders: PlaceholderLocation[];
  /** 表头匹配清单 */
  tables: TableHeaderMatch[];
}

// ---------- API 响应格式 ----------

/** 通用 API 响应 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/** 上传响应 */
export interface UploadResponse {
  fileId: string;
  fileName: string;
  fileSize: number;
  sessionId?: string;
}



// ---------- 子树复制模型 ----------

/** 子树复制统计 */
export interface SubtreeCopyStats {
  /** 已复制的章节数 */
  chaptersCopied: number;
  /** 插入的段落数 */
  paragraphsInserted: number;
  /** 填充的表格数 */
  tablesFilled: number;
  /** 替换的占位符数 */
  placeholdersReplaced: number;
  /** 插入的数据行数（列表型表格行数 + 键值对单元格数） */
  rowsInserted: number;
  /** 键值对表格填充的单元格数 */
  keyValueCellsFilled: number;
  /** 格式校验是否通过 */
  validationPassed: boolean;
}

// ============================================================
// 统一数据结构 A（UnifiedReportData）— 取数/填数/校验/预览共享
// ============================================================

/** 带校验标记的单元格值 */
export interface ValidationCell {
  /** 原始值文本 */
  value: string;
  /** 是否通过质量校验 */
  valid: boolean;
  /** 校验不通过原因（可选） */
  reason?: string;
}

/** 辅助函数：提取纯文本，兼容 string | ValidationCell */
export function getValidationText(val: string | ValidationCell): string {
  return typeof val === 'string' ? val : val.value;
}

/** 辅助函数：判断是否通过校验（纯字符串视为通过） */
export function isCellValid(val: string | ValidationCell): boolean {
  return typeof val === 'string' ? true : val.valid;
}

/** 键值对 */
export interface KeyValuePair {
  key: string;
  value: string | ValidationCell;
}

/** 签名数据 */
export interface SignatureBlock {
  inspectorName: string;
  inspectorDate: string;
  checkerName: string;
  checkerDate: string;
  reviewerName: string;
  reviewerDate: string;
}

/** 列表型表格 */
export interface DataTable {
  /** 实体类型标识 */
  tableType: string;
  /** 列名（中文表头） */
  headers: string[];
  /** 数据行，每行是 header → value 映射（value 兼容 string | ValidationCell） */
  rows: Record<string, string | ValidationCell>[];
}

/** 章节数据 */
export interface SectionData {
  /** 章节编号 "1-1""2-3" */
  id: string;
  /** 章节标题 */
  title: string;
  /** 键值对列表 */
  kvPairs: KeyValuePair[];
  /** 列表型表格 */
  tables: DataTable[];
  /** 签名数据 */
  signature: SignatureBlock;
  /** 对应模板中的表格索引（由模板分析器提供，fillBySubtreeCopyV2 用于直接定位） */
  tableIndex?: number;
  /** 混合表标记：本 section 中的 kvPairs + tables 来自同一个混合 KV+List 表格 */
  hasHybridTable?: boolean;
  /** 嵌套KV表标记：kvPairs 来自嵌套KV表（含类别标题行） */
  hasNestedKvTable?: boolean;
  /** 混合表中列表表头区所占行数 */
  hybridListHeaderRows?: number;
}

/**
 * 统一报告数据（纯数据层，不含任何 Word XML）
 *
 * **单源真相**: `shared/schema/report-data.json` (JSON Schema draft-07)
 * 本接口定义必须与该 Schema 保持同步。修改数据模型时请先更新 Schema 文件。
 *
 * @see {@link ../../shared/schema/report-data.json}
 */
export interface UnifiedReportData {
  basicInfo: BasicInfo;
  sections: SectionData[];
}

// ---------- 模板结构定义 ----------

/** 模板章节结构 */
export interface TemplateSection {
  sectionId: string;
  placeholderFields: { mapTo: string; pattern: string }[];
  tables: {
    tableIndex: number;
    isKeyValue: boolean;
    /** 混合表标记：Row 0 为 KV 键值对，Row 1+ 为列表 */
    isHybrid?: boolean;
    /** 混合表中列表表头区所占行数（含列名行），用于 fillTableFromSource 的 dataStartRow 偏移 */
    hybridListHeaderRows?: number;
    /** 嵌套KV表标记：Row 0 看似列表表头，但数据行包含大量 vMerge/gridSpan 嵌套结构 */
    isNestedKv?: boolean;
    kvKeys?: string[];
    columns?: { header: string; mappedField: string }[];
  }[];
  signaturePosition: { tableIndex: number } | null;
  /** 签名行字段标签列表（从表格最后一行提取的文本） */
  signatureFields?: string[];
}

/** 模板结构定义 */
export interface TemplateStructure {
  sections: TemplateSection[];
}

// ---------- 校验规则 ----------

/** 校验规则 */
export interface ValidationRule {
  scope: { sectionId?: string; tableType?: string };
  type: "required" | "format" | "range" | "consistency";
  field: string;
  config?: {
    pattern?: string;
    min?: number;
    max?: number;
    equalsField?: string;
  };
}

/** 校验错误 */
export interface ValidationError {
  sectionId: string;
  field: string;
  message: string;
  ruleType: string;
}

/** 校验报告 */
export interface ValidationReport {
  passed: boolean;
  errors: ValidationError[];
  summary: { totalChecks: number; passedCount: number; failedCount: number };
}
