import {
  UnifiedReportData, ValidationRule, ValidationReport, ValidationError, SectionData, DataTable,
} from "../types";
import { logger } from "../utils/logger";

/**
 * 数据校验引擎 — 基于 UnifiedReportData + ValidationRule[] 进行规则校验
 * 支持 required / format / range / consistency 四种校验类型
 */
export class ValidationService {
  /**
   * 对 UnifiedReportData 执行规则校验
   * @param data 统一报告数据
   * @param rules 校验规则列表
   * @returns ValidationReport
   */
  validate(data: UnifiedReportData, rules: ValidationRule[]): ValidationReport {
    const errors: ValidationError[] = [];
    let totalChecks = 0;
    let passedCount = 0;
    let failedCount = 0;

    for (const rule of rules) {
      const scopedSections = this.getScopedSections(data, rule.scope);

      for (const section of scopedSections) {
        if (rule.scope.tableType) {
          // 表格级校验
          const targetTables = section.tables.filter(t => t.tableType === rule.scope.tableType);
          for (const table of targetTables) {
            const result = this.applyRule(table, rule, section.id);
            totalChecks += result.total;
            passedCount += result.passed;
            failedCount += result.failed;
            errors.push(...result.errors);
          }
        } else {
          // 章节级校验（键值对、签名、无表格字段）
          const result = this.applySectionRule(section, rule);
          totalChecks += result.total;
          passedCount += result.passed;
          failedCount += result.failed;
          errors.push(...result.errors);
        }
      }
    }

    const passed = errors.length === 0;
    logger.info(`数据校验完成: ${passedCount}/${totalChecks} 通过, ${failedCount} 失败`);

    return {
      passed,
      errors,
      summary: { totalChecks, passedCount, failedCount },
    };
  }

  /** 获取符合 scope 的章节列表 */
  private getScopedSections(data: UnifiedReportData, scope: { sectionId?: string }): SectionData[] {
    if (scope.sectionId) {
      const s = data.sections.find(s => s.id === scope.sectionId);
      return s ? [s] : [];
    }
    return data.sections;
  }

  /** 对表格数据行执行规则 */
  private applyRule(
    table: DataTable, rule: ValidationRule, sectionId: string
  ): { total: number; passed: number; failed: number; errors: ValidationError[] } {
    const errors: ValidationError[] = [];
    let total = 0, passed = 0, failed = 0;

    for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
      const row = table.rows[rowIdx];
      const value = row[rule.field];
      total++;

      const err = this.checkValue(value, rule, sectionId, rule.field, rowIdx);
      if (err) {
        errors.push(err);
        failed++;
      } else {
        passed++;
      }

      // consistency 类型：只校验第一行（作为模板参照）
      if (rule.type === "consistency") break;
    }

    return { total, passed, failed, errors };
  }

  /** 对章节级数据（kvPairs / signature / basicInfo）执行规则 */
  private applySectionRule(
    section: SectionData, rule: ValidationRule
  ): { total: number; passed: number; failed: number; errors: ValidationError[] } {
    const errors: ValidationError[] = [];
    let total = 0, passed = 0, failed = 0;

    if (rule.field.startsWith("kv:")) {
      // 键值对校验
      const kvKey = rule.field.slice(3);
      const kv = section.kvPairs.find(k => k.key === kvKey);
      total++;
      if (kv) {
        const err = this.checkValue(kv.value, rule, section.id, rule.field);
        if (err) { errors.push(err); failed++; } else { passed++; }
      } else if (rule.type === "required") {
        errors.push({ sectionId: section.id, field: rule.field, message: `键值对 "${kvKey}" 缺失`, ruleType: rule.type });
        failed++;
      } else { passed++; }
    } else if (rule.field.startsWith("sig:")) {
      // 签名校验
      const sigField = rule.field.slice(4) as keyof typeof section.signature;
      const sig = section.signature;
      total++;
      const value = sig[sigField] as string;
      if (value) {
        const err = this.checkValue(value, rule, section.id, rule.field);
        if (err) { errors.push(err); failed++; } else { passed++; }
      } else if (rule.type === "required") {
        errors.push({ sectionId: section.id, field: rule.field, message: `签名字段 "${sigField}" 缺失`, ruleType: rule.type });
        failed++;
      } else { passed++; }
    }

    return { total, passed, failed, errors };
  }

  /** 单项值校验 */
  private checkValue(
    value: string | undefined, rule: ValidationRule, sectionId: string, field: string, rowIdx?: number
  ): ValidationError | null {
    const location = rowIdx !== undefined ? `${sectionId}[row:${rowIdx}]` : sectionId;

    // required
    if (rule.type === "required" && (!value || value.trim() === "")) {
      return { sectionId: location, field, message: `必填字段 "${field}" 为空`, ruleType: "required" };
    }

    if (!value) return null;

    // format
    if (rule.type === "format" && rule.config?.pattern) {
      const re = new RegExp(rule.config.pattern);
      if (!re.test(value)) {
        return { sectionId: location, field, message: `字段 "${field}" 格式不匹配: ${value}`, ruleType: "format" };
      }
    }

    // range
    if (rule.type === "range" && rule.config) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        if (rule.config.min !== undefined && num < rule.config.min) {
          return { sectionId: location, field, message: `字段 "${field}" 值 ${num} 小于最小值 ${rule.config.min}`, ruleType: "range" };
        }
        if (rule.config.max !== undefined && num > rule.config.max) {
          return { sectionId: location, field, message: `字段 "${field}" 值 ${num} 大于最大值 ${rule.config.max}`, ruleType: "range" };
        }
      }
    }

    return null;
  }
}

export const validationService = new ValidationService();
