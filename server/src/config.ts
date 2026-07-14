import path from "path";

/** 全局配置 */
export const config = {
  /** 服务端口 */
  port: parseInt(process.env.PORT || "3100", 10),

  /** 工作目录根路径 */
  rootDir: path.resolve(__dirname, ".."),

  /** 上传目录 */
  uploadDir: path.resolve(__dirname, "..", "uploads"),

  /** 生成文件输出目录 */
  outputDir: path.resolve(__dirname, "..", "output"),

  /** 模板解压缓存目录 */
  sessionsDir: path.resolve(__dirname, "..", "sessions"),

  /** 临时文件 TTL（毫秒），默认 1 小时 */
  fileTTL: parseInt(process.env.FILE_TTL || "3600000", 10),

  /** 清理间隔（毫秒），默认 30 分钟 */
  cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL || "1800000", 10),

  /** 上传文件大小限制，默认 50MB */
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "52428800", 10),

  /** 数字员工信息 */
  employee: {
    employeeId: process.env.EMPLOYEE_ID || "annual-report-filler-001",
    employeeName: process.env.EMPLOYEE_NAME || "年度检查报告自动填充",
    version: process.env.EMPLOYEE_VERSION || "1.0.0",
    capabilities: [
      "年度检查报告自动填充",
      "docx模板解析",
      "JSON/YAML数据填充",
    ],
    supportedFormats: {
      templates: [".docx"],
      data: [".json", ".yaml", ".yml", ".rj"],
    },
  },

  /** webhook 回调密钥（可选） */
  webhookSecret: process.env.WEBHOOK_SECRET || "",

  /** Python 解释器路径（可选，默认 python3/python） */
  pythonPath: process.env.PYTHON_PATH || "python",

  /** Python report_filler 包所在目录 */
  pythonFillerDir: path.resolve(__dirname, "..", "..", "python_report_filler"),
};
