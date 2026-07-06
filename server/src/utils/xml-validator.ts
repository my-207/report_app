/**
 * XML 格式校验模块
 *
 * 校验填充后 document.xml 的表格结构完整性，
 * 确保与填充前的模板文件格式保持一致。
 */

import { extractTagContent } from "./xml-utils";
import { logger } from "./logger";
import fs from "fs";
import path from "path";

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 校验 document.xml 的 XML 语法和表格结构完整性
 *
 * 检查项：
 *   1. 表格开闭标签配对（<w:tbl> vs </w:tbl>）
 *   2. 每个表格至少包含 1 行
 *   3. 每行 <w:tc> 开闭标签数量匹配
 */
export function validateDocumentXml(xml: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 表格标签配对检查
  const tblOpenCount = (xml.match(/<w:tbl[ >]/g) || []).length;
  const tblCloseCount = (xml.match(/<\/w:tbl>/g) || []).length;
  if (tblOpenCount !== tblCloseCount) {
    errors.push(
      `表格标签不配对: <w:tbl> ${tblOpenCount} 个, </w:tbl> ${tblCloseCount} 个`
    );
  }

  // 2. 行标签配对检查
  const trOpenCount = (xml.match(/<w:tr[ >]/g) || []).length;
  const trCloseCount = (xml.match(/<\/w:tr>/g) || []).length;
  if (trOpenCount !== trCloseCount) {
    errors.push(
      `行标签不配对: <w:tr> ${trOpenCount} 个, </w:tr> ${trCloseCount} 个`
    );
  }

  // 3. 逐个表格结构检查
  const tblRegex = /<w:tbl[ >]/g;
  let tblMatch: RegExpExecArray | null;
  let tblIdx = 0;

  while ((tblMatch = tblRegex.exec(xml)) !== null) {
    tblIdx++;
    const tblContent = extractTagContent(xml, tblMatch.index, "w:tbl");
    if (!tblContent) {
      errors.push(`表格 #${tblIdx}: 无法提取完整 XML 内容`);
      continue;
    }

    // 检查每行单元格标签配对
    const trRegex = /<w:tr[ >]/g;
    let trMatch: RegExpExecArray | null;
    let trIdx = 0;

    while ((trMatch = trRegex.exec(tblContent)) !== null) {
      trIdx++;
      const trContent = extractTagContent(tblContent, trMatch.index, "w:tr");
      if (!trContent) {
        warnings.push(`表格 #${tblIdx} 行 #${trIdx}: 无法提取完整行内容`);
        continue;
      }

      const tcOpenCount = (trContent.match(/<w:tc[ >]/g) || []).length;
      const tcCloseCount = (trContent.match(/<\/w:tc>/g) || []).length;
      if (tcOpenCount !== tcCloseCount) {
        errors.push(
          `表格 #${tblIdx} 行 #${trIdx}: 单元格标签不配对 ` +
          `(<w:tc> ${tcOpenCount} 个, </w:tc> ${tcCloseCount} 个)`
        );
      }
    }

    if (trIdx === 0) {
      warnings.push(`表格 #${tblIdx}: 不包含任何行`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 对比填充前后表格结构一致性
 *
 * 检查项：
 *   1. 表格总数不变
 *   2. 每个表格列数不变（第一行 <w:tc> 数量）
 *   3. 每个表格行数只增不减（允许追加数据行）
 */
export function compareTableStructure(
  beforeXml: string,
  afterXml: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 提取填充前的表格信息
  const beforeTables = extractTableInfos(beforeXml);
  // 提取填充后的表格信息
  const afterTables = extractTableInfos(afterXml);

  // 1. 表格总数
  if (beforeTables.length !== afterTables.length) {
    errors.push(
      `表格总数不一致: 填充前 ${beforeTables.length} 个, 填充后 ${afterTables.length} 个`
    );
  }

  // 2. 逐表对比
  const maxLen = Math.max(beforeTables.length, afterTables.length);
  for (let i = 0; i < maxLen; i++) {
    const before = beforeTables[i];
    const after = afterTables[i];

    if (!before) {
      errors.push(`表格 #${i + 1}: 填充前不存在，填充后新增`);
      continue;
    }
    if (!after) {
      errors.push(`表格 #${i + 1}: 填充前存在，填充后丢失`);
      continue;
    }

    // 列数对比（只检查第一行）
    if (before.colCount !== after.colCount) {
      errors.push(
        `表格 #${i + 1}: 列数不一致 ` +
        `(填充前 ${before.colCount} 列, 填充后 ${after.colCount} 列)`
      );
    }

    // 行数对比（允许增加）
    if (after.rowCount < before.rowCount) {
      errors.push(
        `表格 #${i + 1}: 行数减少 ` +
        `(填充前 ${before.rowCount} 行, 填充后 ${after.rowCount} 行)`
      );
    } else if (after.rowCount > before.rowCount) {
      warnings.push(
        `表格 #${i + 1}: 行数增加 ` +
        `(填充前 ${before.rowCount} 行, 填充后 ${after.rowCount} 行)`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** 表格基本信息 */
interface TableInfo {
  colCount: number;
  rowCount: number;
}

/** 从 XML 中提取所有表格的列数和行数 */
function extractTableInfos(xml: string): TableInfo[] {
  const infos: TableInfo[] = [];
  const tblRegex = /<w:tbl[ >]/g;
  let tblMatch: RegExpExecArray | null;

  while ((tblMatch = tblRegex.exec(xml)) !== null) {
    const tblContent = extractTagContent(xml, tblMatch.index, "w:tbl");
    if (!tblContent) {
      infos.push({ colCount: 0, rowCount: 0 });
      continue;
    }

    // 行数
    const trMatches = tblContent.match(/<w:tr[ >]/g);
    const rowCount = trMatches ? trMatches.length : 0;

    // 第一行列数
    const firstTrRegex = /<w:tr[ >]/;
    const trMatch = firstTrRegex.exec(tblContent);
    let colCount = 0;
    if (trMatch) {
      const firstTr = extractTagContent(tblContent, trMatch.index, "w:tr");
      if (firstTr) {
        const tcMatches = firstTr.match(/<w:tc[ >]/g);
        colCount = tcMatches ? tcMatches.length : 0;
      }
    }

    infos.push({ colCount, rowCount });
  }

  return infos;
}

/**
 * 校验 docx 解压目录结构完整性
 *
 * 检查项：
 *   1. [Content_Types].xml 存在
 *   2. word/document.xml 存在
 *   3. _rels/.rels 存在
 */
export function validateStructureIntegrity(unpackDir: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const requiredFiles = [
    "[Content_Types].xml",
    "word/document.xml",
    "_rels/.rels",
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(unpackDir, file);
    if (!fs.existsSync(filePath)) {
      errors.push(`缺少必要文件: ${file}`);
    }
  }

  // 检查 word/_rels/document.xml.rels
  const docRels = path.join(unpackDir, "word", "_rels", "document.xml.rels");
  if (!fs.existsSync(docRels)) {
    warnings.push("缺少 word/_rels/document.xml.rels");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 聚合校验入口
 *
 * 执行顺序：
 *   1. validateStructureIntegrity — 目录结构检查
 *   2. validateDocumentXml — XML 语法检查
 *   3. compareTableStructure — 表格一致性对比
 */
export function validateFilledDocument(
  beforeXml: string,
  afterXml: string,
  unpackDir: string
): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  logger.info("开始格式校验...");

  // 1. 目录结构
  const structResult = validateStructureIntegrity(unpackDir);
  allErrors.push(...structResult.errors);
  allWarnings.push(...structResult.warnings);
  logger.info(`  [1/3] 目录结构: ${structResult.valid ? "通过" : "失败"}`);

  // 2. XML 语法
  const xmlResult = validateDocumentXml(afterXml);
  allErrors.push(...xmlResult.errors);
  allWarnings.push(...xmlResult.warnings);
  logger.info(`  [2/3] XML 语法: ${xmlResult.valid ? "通过" : "失败"}`);

  // 3. 表格一致性
  const compareResult = compareTableStructure(beforeXml, afterXml);
  allErrors.push(...compareResult.errors);
  allWarnings.push(...compareResult.warnings);
  logger.info(`  [3/3] 表格一致性: ${compareResult.valid ? "通过" : "失败"}`);

  const valid = allErrors.length === 0;
  if (valid) {
    logger.info(`格式校验通过 (${allWarnings.length} 个警告)`);
  } else {
    logger.error(`格式校验失败: ${allErrors.join("; ")}`);
  }

  return { valid, errors: allErrors, warnings: allWarnings };
}
