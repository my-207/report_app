import * as yaml from "js-yaml";
import { ReportData, BasicInfo, TableData } from "../types";

/** 数据解析与校验服务 */
export class DataService {
  /** 必填的 basicInfo 字段 */
  private readonly REQUIRED_BASIC_FIELDS: (keyof BasicInfo)[] = [
    "reportNumber",
    "companyName",
    "deviceName",
    "reportTypePrefix",
    "inspectionStartDate",
    "inspectionEndDate",
    "inspectorDate",
    "checkerDate",
    "reviewerDate",
  ];

  /** 解析 JSON 数据 */
  parseJSON(content: string): ReportData {
    try {
      const data = JSON.parse(content);
      return this.validateAndNormalize(data);
    } catch (err: any) {
      throw new Error(`JSON 解析失败: ${err.message}`);
    }
  }

  /** 解析 YAML 数据 */
  parseYAML(content: string): ReportData {
    try {
      const data = yaml.load(content);
      if (data === null || data === undefined) {
        throw new Error("YAML 内容为空");
      }
      if (typeof data !== "object") {
        throw new Error("YAML 格式错误，期望对象类型");
      }
      return this.validateAndNormalize(data as Record<string, unknown>);
    } catch (err: any) {
      if (err.message.startsWith("YAML") || err.message.startsWith("JSON")) {
        throw err;
      }
      throw new Error(`YAML 解析失败: ${err.message}`);
    }
  }

  /** 自动检测并解析（根据文件扩展名） */
  parse(content: string, format: "json" | "yaml"): ReportData {
    if (format === "yaml") {
      return this.parseYAML(content);
    }
    return this.parseJSON(content);
  }

  /** 校验并规范化数据 */
  private validateAndNormalize(raw: Record<string, unknown>): ReportData {
    // 校验 basicInfo
    if (!raw.basicInfo || typeof raw.basicInfo !== "object") {
      throw new Error("数据缺少 basicInfo 字段");
    }

    const basicInfo = raw.basicInfo as Record<string, unknown>;

    // 检查必填字段
    const missingFields = this.REQUIRED_BASIC_FIELDS.filter(
      (field) => !basicInfo[field] || String(basicInfo[field]).trim() === ""
    );
    if (missingFields.length > 0) {
      throw new Error(`basicInfo 缺少必填字段: ${missingFields.join(", ")}`);
    }

    // 校验报告编号格式
    const reportNumber = String(basicInfo.reportNumber).trim();
    if (!/^[A-Z]{3,5}-\d{4}-\d{4}-20\d{2}$/.test(reportNumber)) {
      // 非严格校验，仅警告格式不匹配预期
      console.warn(`报告编号格式不标准: "${reportNumber}"，预期格式: XXXXX-XXXX-XXXX-20XX`);
    }

    // 校验 tables
    if (!raw.tables || !Array.isArray(raw.tables)) {
      throw new Error("数据缺少 tables 字段或格式错误（期望数组）");
    }

    const tables = raw.tables.map((t: unknown, idx: number): TableData => {
      if (!t || typeof t !== "object") {
        throw new Error(`tables[${idx}] 格式错误`);
      }
      const table = t as Record<string, unknown>;

      if (!table.tableName || String(table.tableName).trim() === "") {
        throw new Error(`tables[${idx}] 缺少 tableName 字段`);
      }
      if (!Array.isArray(table.headers) || table.headers.length === 0) {
        throw new Error(`tables[${idx}] (${table.tableName}) headers 不能为空`);
      }
      if (!Array.isArray(table.rows)) {
        throw new Error(`tables[${idx}] (${table.tableName}) rows 格式错误（期望数组）`);
      }

      const headers = table.headers.map((h) => String(h));
      const rows = (table.rows as unknown[][]).map((row) => {
        if (!Array.isArray(row)) {
          throw new Error(`tables[${idx}] (${table.tableName}) 行数据格式错误`);
        }
        return row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)));
      });

      return {
        tableName: String(table.tableName).trim(),
        headers,
        rows,
      };
    });

    return {
      basicInfo: {
        reportNumber,
        companyName: String(basicInfo.companyName).trim(),
        deviceName: String(basicInfo.deviceName).trim(),
        reportTypePrefix: String(basicInfo.reportTypePrefix).trim(),
        inspectionStartDate: String(basicInfo.inspectionStartDate).trim(),
        inspectionEndDate: String(basicInfo.inspectionEndDate).trim(),
        inspectorDate: String(basicInfo.inspectorDate).trim(),
        checkerDate: String(basicInfo.checkerDate).trim(),
        reviewerDate: String(basicInfo.reviewerDate).trim(),
      },
      tables,
    };
  }

}

export const dataService = new DataService();
