import { ReportData, FillResult, BasicInfo, UnifiedReportData, DataTable, KeyValuePair, isCellValid, getValidationText } from "../types";
import { logger } from "../utils/logger";
import { templateService } from "./template.service";
import { docxService } from "./docx.service";
import { xmlSubtreeInserter } from "./xml-subtree-inserter.service";
import { extractTagContent, isRowEmpty, getCellMergedTexts, findAllTags, analyzeRowCells } from "../utils/xml-utils";
import { validateFilledDocument } from "../utils/xml-validator";

/** 填充引擎：占位符替换 + 表格填充 + 子树复制 */
export class FillerService {
  /**
   * 占位符 → 数据字段映射表
   *
   * 核心原则：只匹配包含 X 字符的占位符模式，绝不触碰模板中已有的实际内容。
   * 模板中已有的真实日期、编号、公司名等必须原样保留。
   */
  private readonly PLACEHOLDER_MAP: { regex: RegExp; getValue: (data: ReportData) => string; priority?: number }[] = [
    {
      // 报告类型前缀：XXXXX/XXXXX/XXXX/XXXXXX
      regex: /X{4,}\/X{4,}\/X{4,}\/X{4,}/g,
      getValue: (d) => d.basicInfo.reportTypePrefix,
      priority: 10,
    },
    {
      // 报告编号：XXXXX-XXXX-XXXX-202X（含 X 占位符 + 年份占位符）
      regex: /[A-Z]*-X{3,}-X{3,}-20\dX/g,
      getValue: (d) => d.basicInfo.reportNumber,
      priority: 9,
    },
    {
      // 设备名称：10个以上 X
      regex: /X{10,}(?!\/)/g,
      getValue: (d) => d.basicInfo.deviceName,
      priority: 8,
    },
    {
      // 公司名称：X...X公司
      regex: /X{6,}公司/g,
      getValue: (d) => d.basicInfo.companyName,
      priority: 7,
    },
    {
      // 日期范围：202X年X月-202X年X月（含 X 占位符）
      regex: /20\dX年[\s\u3000]*[\dX]+月[\s\u3000]*-[\s\u3000]*20\dX年[\s\u3000]*[\dX]+月/g,
      getValue: (d) => `${d.basicInfo.inspectionStartDate}-${d.basicInfo.inspectionEndDate}`,
      priority: 6,
    },
    {
      // 签名日期：202X年X月XX日（含 X 占位符）
      regex: /20\dX年[\dX]+月[\dX]+日/g,
      getValue: () => "",
      priority: 5,
    },
    {
      // 备用签名日期：20XX年XX月XX日（全 X 占位）
      regex: /20XX年XX月XX日/g,
      getValue: () => "",
      priority: 4,
    },
  ];

  // ==================== 原有 JSON 数据填充（保留兼容） ====================

  /** 执行填充 */
  async fill(sessionId: string, data: ReportData): Promise<FillResult> {
    const stats = { placeholdersReplaced: 0, tablesFilled: 0, rowsInserted: 0 };
    const warnings: string[] = [];

    let xml = await templateService.getDocumentXml(sessionId);

    logger.info("阶段1: 文本占位符替换");
    const phase1Result = this.replacePlaceholders(xml, data);
    xml = phase1Result.xml;
    stats.placeholdersReplaced = phase1Result.count;
    warnings.push(...phase1Result.warnings);

    logger.info("阶段2: 表格数据填充");
    const phase2Result = this.fillTables(xml, data);
    xml = phase2Result.xml;
    stats.tablesFilled = phase2Result.tablesFilled;
    stats.rowsInserted = phase2Result.rowsInserted;
    warnings.push(...phase2Result.warnings);

    await templateService.saveDocumentXml(sessionId, xml);

    const result: FillResult = {
      success: true,
      outputFileName: "",
      downloadUrl: "",
      stats,
      warnings,
    };

    logger.info(
      `填充完成: ${stats.placeholdersReplaced} 占位符, ${stats.tablesFilled} 表, ${stats.rowsInserted} 行`
    );

    return result;
  }



  /** 在模板 XML 中查找与源表格表头匹配的表格索引 */
  private findMatchingTemplateTable(
    xml: string,
    sourceTableXml: string,
    isKv: boolean = false
  ): { tableIndex: number } | null {
    // 提取源表格的表头（使用合并文本）
    const sourceHeaders: string[] = [];
    const firstTrRegex = /<w:tr[ >]/;
    const trMatch = firstTrRegex.exec(sourceTableXml);
    if (trMatch) {
      const firstTr = extractTagContent(sourceTableXml, trMatch.index, "w:tr");
      if (firstTr) {
        const merged = getCellMergedTexts(firstTr);
        for (const t of merged) {
          if (t && t.length < 50) sourceHeaders.push(t.trim());
        }
      }
    }

    if (sourceHeaders.length === 0) return null;

    // 遍历模板中的所有表格
    const tblRegex = /<w:tbl[ >]/g;
    let tblMatch: RegExpExecArray | null;
    let tblIdx = 0;

    while ((tblMatch = tblRegex.exec(xml)) !== null) {
      const tbl = extractTagContent(xml, tblMatch.index, "w:tbl");
      if (!tbl) { tblIdx++; continue; }

      // 提取模板表格的表头（使用合并文本）
      const templateHeaders: string[] = [];
      const trRegex2 = /<w:tr[ >]/;
      const trMatch2 = trRegex2.exec(tbl);
      if (trMatch2) {
        const firstTr = extractTagContent(tbl, trMatch2.index, "w:tr");
        if (firstTr) {
          const merged = getCellMergedTexts(firstTr);
          for (const t of merged) {
            if (t && t.length < 50) templateHeaders.push(t.trim());
          }
        }
      }

      if (templateHeaders.length > 0) {
        const score = this.matchHeaders(templateHeaders, sourceHeaders);
        // 键值对表降低阈值（标签数少容易匹配）
        const threshold = isKv ? 0.25 : 0.35;
        if (score >= threshold) {
          return { tableIndex: tblIdx };
        }
      }

      tblIdx++;
    }

    return null;
  }

  /** 宽松匹配：过滤掉 sourceReport 等噪声列名后匹配 */
  private findMatchingTemplateTableLoose(
    xml: string,
    sourceTableXml: string
  ): { tableIndex: number } | null {
    const sourceHeaders: string[] = [];
    const firstTrRegex = /<w:tr[ >]/;
    const trMatch = firstTrRegex.exec(sourceTableXml);
    if (trMatch) {
      const firstTr = extractTagContent(sourceTableXml, trMatch.index, "w:tr");
      if (firstTr) {
        const merged = getCellMergedTexts(firstTr);
        for (const t of merged) {
          if (t && t.length < 50) sourceHeaders.push(t.trim());
        }
      }
    }

    if (sourceHeaders.length === 0) return null;

    // 过滤掉噪声列名（sourceReport 列名较通用，会干扰匹配）
    const noiseNames = new Set(["所属管道", "sourceReport", "管道"]);
    const cleanSourceHeaders = sourceHeaders.filter(h => !noiseNames.has(h));
    if (cleanSourceHeaders.length < 2) return null;

    const tblRegex = /<w:tbl[ >]/g;
    let tblMatch: RegExpExecArray | null;
    let tblIdx = 0;
    let bestScore = 0;
    let bestIdx = -1;

    while ((tblMatch = tblRegex.exec(xml)) !== null) {
      const tbl = extractTagContent(xml, tblMatch.index, "w:tbl");
      if (!tbl) { tblIdx++; continue; }

      const templateHeaders: string[] = [];
      const trRegex2 = /<w:tr[ >]/;
      const trMatch2 = trRegex2.exec(tbl);
      if (trMatch2) {
        const firstTr = extractTagContent(tbl, trMatch2.index, "w:tr");
        if (firstTr) {
          const merged = getCellMergedTexts(firstTr);
          for (const t of merged) {
            if (t && t.length < 50) templateHeaders.push(t.trim());
          }
        }
      }

      if (templateHeaders.length > 0) {
        const score = this.matchHeaders(templateHeaders, cleanSourceHeaders);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = tblIdx;
        }
      }
      tblIdx++;
    }

    return bestScore >= 0.2 && bestIdx >= 0 ? { tableIndex: bestIdx } : null;
  }

  /** 表头匹配度计算 */
  private matchHeaders(templateHeaders: string[], dataHeaders: string[]): number {
    if (templateHeaders.length === 0 || dataHeaders.length === 0) return 0;

    let matches = 0;
    for (const dh of dataHeaders) {
      const dhLower = dh.toLowerCase().trim();
      for (const th of templateHeaders) {
        const thLower = th.toLowerCase().trim();
        if (thLower.includes(dhLower) || dhLower.includes(thLower)) {
          matches++;
          break;
        }
      }
    }

    return matches / Math.max(dataHeaders.length, templateHeaders.length);
  }

  // ==================== 占位符替换 ====================

  private replacePlaceholders(
    xml: string,
    data: ReportData
  ): { xml: string; count: number; warnings: string[] } {
    let count = 0;
    const warnings: string[] = [];
    let modifiedXml = xml;

    const signatureDates = [
      data.basicInfo.inspectorDate,
      data.basicInfo.checkerDate,
      data.basicInfo.reviewerDate,
    ].filter(d => d && d.trim()); // 过滤空日期

    // 签名日期不在全局替换，由 fillSignatureRowDirect 在表格填充阶段处理
    // 全局只替换非签名占位符（报告编号、设备名称等）

    const wtRegex = /(<w:t\b[^>]*>)(.*?)(<\/w:t>)/g;

    modifiedXml = modifiedXml.replace(wtRegex, (match, openTag, text, closeTag) => {
      let newText = text;

      for (const { regex, getValue } of this.PLACEHOLDER_MAP) {
        if (regex.test(newText)) {
          const value = getValue(data);
          if (value) {
            // 有数据 → 替换占位符
            newText = newText.replace(regex, () => {
              count++;
              return value;
            });
          }
          // 签名日期占位符（getValue 返回空字符串）→ 不在此处理，保留原样
          // 由 fillSignatureRowDirect 在表格填充阶段处理
        }
      }

      return `${openTag}${newText}${closeTag}`;
    });

    // 多 run 联合替换（报告编号含 X 占位符）
    // 注意：只匹配包含 X 字符的占位符模式，不触碰已填充的实际内容
    // 如果 reportNumber 为空，跳过不替换
    const reportNumber = data.basicInfo.reportNumber;
    if (reportNumber) {
      const multiRunReportRegex = /(<w:r\b[^>]*>(?:[\s\S](?!<\/w:r>))*<w:t\b[^>]*>)X{2,5}(<\/w:t>(?:[\s\S](?!<\/w:r>))*<\/w:r>)\s*(<w:r\b[^>]*>(?:[\s\S](?!<\/w:r>))*<w:t\b[^>]*>)-(<\/w:t>(?:[\s\S](?!<\/w:r>))*<\/w:r>)\s*(<w:r\b[^>]*>(?:[\s\S](?!<\/w:r>))*<w:t\b[^>]*>)X{3,4}(<\/w:t>(?:[\s\S](?!<\/w:r>))*<\/w:r>)\s*(<w:r\b[^>]*>(?:[\s\S](?!<\/w:r>))*<w:t\b[^>]*>)-(<\/w:t>(?:[\s\S](?!<\/w:r>))*<\/w:r>)\s*(<w:r\b[^>]*>(?:[\s\S](?!<\/w:r>))*<w:t\b[^>]*>)X{3,4}(<\/w:t>(?:[\s\S](?!<\/w:r>))*<\/w:r>)\s*(<w:r\b[^>]*>(?:[\s\S](?!<\/w:r>))*<w:t\b[^>]*>)-(<\/w:t>(?:[\s\S](?!<\/w:r>))*<\/w:r>)\s*(<w:r\b[^>]*>(?:[\s\S](?!<\/w:r>))*<w:t\b[^>]*>)20\dX(<\/w:t>(?:[\s\S](?!<\/w:r>))*<\/w:r>)/g;

      if (multiRunReportRegex.test(modifiedXml)) {
        warnings.push("检测到跨多 run 的分散报告编号占位符，已使用整体替换策略");
        multiRunReportRegex.lastIndex = 0;
        modifiedXml = modifiedXml.replace(multiRunReportRegex, (_fullMatch, prefix1, suffix1, prefix2, suffix2, prefix3, suffix3, prefix4, suffix4, prefix5, suffix5, prefix6, suffix6, prefix7, suffix7) => {
          count++;
          return `${prefix1}${reportNumber.slice(0, 5)}${suffix1}${prefix2}-${suffix2}${prefix3}${reportNumber.slice(6, 10)}${suffix3}${prefix4}-${suffix4}${prefix5}${reportNumber.slice(11, 15)}${suffix5}${prefix6}-${suffix6}${prefix7}${reportNumber.slice(16)}${suffix7}`;
        });
      }
    }

    // 签名日期不在全局替换，由 fillSignatureRowDirect 在表格填充阶段处理

    return { xml: modifiedXml, count, warnings };
  }

  // ==================== 表格填充（JSON 数据，保留兼容） ====================

  private fillTables(
    xml: string,
    data: ReportData
  ): { xml: string; tablesFilled: number; rowsInserted: number; warnings: string[] } {
    let tablesFilled = 0;
    let rowsInserted = 0;
    const warnings: string[] = [];
    let modifiedXml = xml;

    for (const tableData of data.tables) {
      const result = this.fillSingleTable(modifiedXml, tableData);
      if (result.found) {
        modifiedXml = result.xml;
        tablesFilled++;
        rowsInserted += result.rowsInserted;
      } else {
        warnings.push(`未找到匹配的表格: "${tableData.tableName}"`);
      }
    }

    return { xml: modifiedXml, tablesFilled, rowsInserted, warnings };
  }

  private fillSingleTable(
    xml: string,
    tableData: { tableName: string; headers: string[]; rows: string[][] }
  ): { found: boolean; xml: string; rowsInserted: number } {
    const tblOpenRegex = /<w:tbl[ >]/g;
    let tblMatch: RegExpExecArray | null;

    while ((tblMatch = tblOpenRegex.exec(xml)) !== null) {
      const tblStart = tblMatch.index;
      const tblContent = extractTagContent(xml, tblStart, "w:tbl");
      if (!tblContent) continue;
      const tblEnd = tblStart + tblContent.length;

      const trOpenRegex = /<w:tr[ >]/g;
      trOpenRegex.lastIndex = 0;
      const firstTrMatch = trOpenRegex.exec(tblContent);
      if (!firstTrMatch) continue;

      const firstTr = extractTagContent(tblContent, firstTrMatch.index, "w:tr");
      if (!firstTr) continue;

      const headerTexts: string[] = [];
      const wtInRowRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
      let wtMatch: RegExpExecArray | null;
      while ((wtMatch = wtInRowRegex.exec(firstTr)) !== null) {
        const t = wtMatch[1].trim();
        if (t && !t.startsWith("<") && t.length < 50) headerTexts.push(t);
      }

      const matchScore = this.matchHeaders(headerTexts, tableData.headers);
      if (matchScore < 0.35) {
        logger.info(`表头匹配分数不足: score=${matchScore.toFixed(2)}, 模板=${headerTexts.join(',')}, 数据=${tableData.headers.join(',')}`);
        continue;
      }

      const rows = tableData.rows;
      let rowsInserted = 0;

      const allRows: { content: string; isEmpty: boolean }[] = [];
      const allTrRegex = /<w:tr[ >]/g;
      allTrRegex.lastIndex = firstTrMatch.index + firstTr.length;

      let trMatch2: RegExpExecArray | null;
      while ((trMatch2 = allTrRegex.exec(tblContent)) !== null) {
        const trContent = extractTagContent(tblContent, trMatch2.index, "w:tr");
        if (!trContent) break;
        allRows.push({ content: trContent, isEmpty: isRowEmpty(trContent) });
      }

      let dataRowIdx = 0;
      const filledRowContents: string[] = [];

      for (const row of allRows) {
        if (dataRowIdx >= rows.length) break;
        // 宽松空行检测：isRowEmpty 或行仅含短占位文本（如 "——"、"示例"、"—"）
        if (row.isEmpty || this.isPlaceholderRow(row.content)) {
          const filledRow = this.fillRow(row.content, rows[dataRowIdx]);
          filledRowContents.push(filledRow);
          dataRowIdx++;
          rowsInserted++;
        }
      }

      if (dataRowIdx < rows.length) {
        const templateRow = this.getTemplateRow(tblContent);
        for (let i = dataRowIdx; i < rows.length; i++) {
          filledRowContents.push(this.fillRow(templateRow, rows[i]));
          rowsInserted++;
        }
      }

      if (filledRowContents.length === 0) {
        return { found: true, xml, rowsInserted: 0 };
      }

      let dataIdx = 0;
      let rebuiltTbl = tblContent;
      for (const row of allRows) {
        if (row.isEmpty && dataIdx < filledRowContents.length) {
          rebuiltTbl = rebuiltTbl.replace(row.content, filledRowContents[dataIdx]);
          dataIdx++;
        }
      }

      if (dataIdx < filledRowContents.length) {
        const remainingRows = filledRowContents.slice(dataIdx).join("");
        rebuiltTbl = rebuiltTbl.replace(/<\/w:tbl>/, `${remainingRows}</w:tbl>`);
      }

      const newXml = xml.slice(0, tblStart) + rebuiltTbl + xml.slice(tblEnd);
      return { found: true, xml: newXml, rowsInserted };
    }

    return { found: false, xml, rowsInserted: 0 };
  }

  private fillRow(rowXml: string, dataRow: string[]): string {
    let filledRow = rowXml;
    let colIdx = 0;

    const tcOpenRegex = /<w:tc[ >]/g;
    let tcMatch: RegExpExecArray | null;

    while ((tcMatch = tcOpenRegex.exec(filledRow)) !== null) {
      const tcStart = tcMatch.index;
      const tcContent = extractTagContent(filledRow, tcStart, "w:tc");
      if (!tcContent) break;

      if (colIdx < dataRow.length) {
        const newTc = tcContent.replace(
          /(<w:t\b[^>]*>)(.*?)(<\/w:t>)/,
          `$1${dataRow[colIdx]}$3`
        );
        filledRow = filledRow.replace(tcContent, newTc);
        tcOpenRegex.lastIndex = tcStart + newTc.length;
      }
      colIdx++;
    }

    return filledRow;
  }

  private getTemplateRow(tblContent: string): string {
    let lastRow = "";
    const trOpenRegex = /<w:tr[ >]/g;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trOpenRegex.exec(tblContent)) !== null) {
      const trContent = extractTagContent(tblContent, trMatch.index, "w:tr");
      if (trContent) lastRow = trContent;
    }
    return lastRow;
  }

  /** 检测行是否仅包含占位文本（如 "——"、"—"、"示例" 等短占位符） */
  private isPlaceholderRow(rowXml: string): boolean {
    const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let hasContent = false;
    let allShortPlaceholder = true;
    let m: RegExpExecArray | null;
    while ((m = wtRegex.exec(rowXml)) !== null) {
      const t = m[1].trim();
      if (t && !t.startsWith("<")) {
        hasContent = true;
        // 短占位符检测：长度 <= 3 且不含中文（如 —、——、-- 等）
        if (t.length > 3 || /[\u4e00-\u9fa5]/.test(t)) {
          allShortPlaceholder = false;
          break;
        }
      }
    }
    return hasContent && allShortPlaceholder;
  }

  // ==================== V2: 基于 UnifiedReportData 的填充（新版） ====================

  /**
   * 使用 UnifiedReportData 填充模板（V2 纯数据路径）
   *
   * 核心设计：
   * - 每个 SectionData 携带 tableIndex（由模板分析器生成），直接定位模板表格
   * - 倒序处理（tableIndex 从大到小），避免前面的填充修改 XML 后导致后续表格位置偏移
   * - KV 表用 section.kvPairs 构建源 XML → fillKeyValueTable
   * - 列表表用 section.tables 构建源 XML → fillTableFromSource
   */
  async fillBySubtreeCopyV2(
    templateSessionId: string,
    unifiedData: UnifiedReportData
  ): Promise<{ fillResult: FillResult; subtreeStats: SubtreeCopyStats }> {
    const stats: SubtreeCopyStats = {
      chaptersCopied: 0, paragraphsInserted: 0, tablesFilled: 0,
      placeholdersReplaced: 0, rowsInserted: 0, keyValueCellsFilled: 0,
      validationPassed: true,
    };
    const warnings: string[] = [];

    let xml: string;
    try {
      xml = await templateService.getDocumentXml(templateSessionId);
      logger.info(`获取document.xml成功, 长度=${xml.length}`);
    } catch (docErr: any) {
      logger.error(`获取document.xml失败: ${docErr.message}`);
      throw docErr;
    }

    // 1. 占位符替换
    const placeholderData: ReportData = { basicInfo: unifiedData.basicInfo, tables: [] };
    const pResult = this.replacePlaceholders(xml, placeholderData);
    
    if (!pResult) {
      throw new Error('replacePlaceholders 返回空值');
    }
    
    xml = pResult.xml;
    stats.placeholdersReplaced = pResult.count;
    warnings.push(...pResult.warnings);

    // 2. 按 tableIndex 降序排序，确保从后往前填充（避免 XML 位置偏移）
    const sortedSections = [...unifiedData.sections].sort((a, b) => {
      const ai = a.tableIndex ?? Number.MAX_SAFE_INTEGER;
      const bi = b.tableIndex ?? Number.MAX_SAFE_INTEGER;
      return bi - ai; // 降序
    });

    for (const section of sortedSections) {
      const tableIndex = section.tableIndex;

      // 混合表：在 KV 填充前扫描模板，计算连续 KV 行数
      let kvRowCount = 0;
      if (tableIndex !== undefined && section.hasHybridTable) {
        const tblRegex = /<w:tbl[ >]/g;
        let tblMatch: RegExpExecArray | null;
        let ti = 0;
        while ((tblMatch = tblRegex.exec(xml)) !== null) {
          if (ti === tableIndex) {
            const tblContent = extractTagContent(xml, tblMatch.index, "w:tbl");
            if (tblContent) {
              const rows = findAllTags(tblContent, "w:tr");
              let skipLeadingMergeTitle = true;
              for (const row of rows) {
                const analysis = analyzeRowCells(row.content);
                // 跳过表头的合并标题行（如"(3-1)埋地管道..."），直到找到第一个数据行
                if (skipLeadingMergeTitle && analysis.isMergeTitleRow) continue;
                skipLeadingMergeTitle = false;
                if (analysis.isKvRow) kvRowCount++;
                else break;
              }
            }
            break;
          }
          ti++;
        }
      }

      try {

      // 2a. 键值对表填充（kvPairs 有数据 或 混合表标记为真）
      if (section.kvPairs.length > 0 || section.hasHybridTable) {
        if (tableIndex !== undefined) {
          // 直接索引定位（精确模式）
          const srcKvXml = this.kvToXml(section.kvPairs);
          const kvResult = xmlSubtreeInserter.fillKeyValueTable(xml, tableIndex, srcKvXml, section.kvPairs);
          if (kvResult.cellsFilled > 0) {
            xml = kvResult.xml;
            stats.tablesFilled++;
            stats.keyValueCellsFilled += kvResult.cellsFilled;
            logger.info(`KV表填充成功: tableIndex=${tableIndex}, cells=${kvResult.cellsFilled}`);
          } else {
            logger.warn(`KV表填充0单元格（精确模式）: tableIndex=${tableIndex}, section=${section.id}, kvKeys=${section.kvPairs.map(kv=>kv.key).join(',')}`);
          }
        } else {
          // 降级：无 tableIndex 时兜底匹配
          const srcKvXml = this.kvToXml(section.kvPairs);
          const matchResult = this.findMatchingTemplateTable(xml, srcKvXml, true);
          if (matchResult !== null) {
            const kvResult = xmlSubtreeInserter.fillKeyValueTable(xml, matchResult.tableIndex, srcKvXml, section.kvPairs);
            if (kvResult.cellsFilled > 0) {
              xml = kvResult.xml;
              stats.tablesFilled++;
              stats.keyValueCellsFilled += kvResult.cellsFilled;
            } else {
              logger.warn(`KV表填充0单元格（降级匹配）: tableIndex=${matchResult.tableIndex}, section=${section.id}`);
            }
          } else {
            logger.warn(`KV表降级匹配失败: section=${section.id}, kvKeys=${section.kvPairs.map(kv=>kv.key).join(',')}`);
          }
        }

        // KV表的签名行填充：为纯KV表或无列表数据路径的混合表补充签名处理
        // 条件：没有列表数据路径（tables为空）时，无论是否混合表都需要在此填充签名
        // 有列表数据的混合表通过2b路径的 fillTableFromSource 已有签名行处理
        const effectiveTableIndex = tableIndex !== undefined ? tableIndex : undefined;
        const sigBlock = section.signature || undefined;
        const hasListDataPath = section.tables && section.tables.length > 0;
        if (!hasListDataPath && sigBlock && effectiveTableIndex !== undefined && 
            (sigBlock.inspectorName || sigBlock.inspectorDate || sigBlock.checkerName || sigBlock.checkerDate || sigBlock.reviewerName || sigBlock.reviewerDate)) {
          const sigResult = xmlSubtreeInserter.fillTableSignature(xml, effectiveTableIndex, sigBlock);
          if (sigResult.filled) {
            xml = sigResult.xml;
            logger.info(`KV表签名行填充成功: tableIndex=${effectiveTableIndex}, section=${section.id}`);
          }
        }
      }

      // 2b. 列表型表格填充（section.tables 有数据时）
      for (const dt of section.tables) {
        const { xml: srcXml, validGrid } = this.dataTableToXml(dt);
        const sigText = section.signature?.inspectorName || "";

        const listHeaderRows = section.hybridListHeaderRows ?? 1;
        const dataStartRow = kvRowCount;

        // 构建签名数据块（用于直接填充签名行姓名和日期）
        const sigBlock = section.signature || undefined;

        if (tableIndex !== undefined) {
          // 直接索引定位（精确模式）
          const fillResult = xmlSubtreeInserter.fillTableFromSource(
            xml, tableIndex, srcXml, sigText, dataStartRow, sigBlock, validGrid
          );
          if (!fillResult) {
            logger.warn(`fillTableFromSource 返回空值: tableIndex=${tableIndex}, section=${section.id}`);
          } else if (fillResult.rowsFilled > 0) {
            xml = fillResult.xml;
            stats.tablesFilled++;
            stats.rowsInserted += fillResult.rowsFilled;
            logger.info(`列表表填充成功: tableIndex=${tableIndex}, rows=${fillResult.rowsFilled}`);
          } else {
            logger.warn(`列表表填充0行（精确模式）: tableIndex=${tableIndex}, section=${section.id}, 表头=${dt.headers?.join(',')}`);
          }
        } else {
          // 降级：无 tableIndex 时使用表头匹配
          const matchResult = this.findMatchingTemplateTable(xml, srcXml, false);
          if (matchResult !== null) {
            const fillResult = xmlSubtreeInserter.fillTableFromSource(
              xml, matchResult.tableIndex, srcXml, sigText, dataStartRow, sigBlock, validGrid
            );
            if (fillResult.rowsFilled > 0) {
              xml = fillResult.xml;
              stats.tablesFilled++;
              stats.rowsInserted += fillResult.rowsFilled;
            } else {
              logger.warn(`降级匹配成功但填充0行: tableIndex=${matchResult.tableIndex}, section=${section.id}`);
            }
          } else {
            // 宽松匹配回退
            logger.warn(`表头精确匹配失败: section=${section.id}, 表头=${dt.headers?.join(',')}`);
            const loose = this.findMatchingTemplateTableLoose(xml, srcXml);
            if (loose !== null) {
              const fillResult = xmlSubtreeInserter.fillTableFromSource(
                xml, loose.tableIndex, srcXml, sigText, dataStartRow, sigBlock, validGrid
              );
              if (fillResult.rowsFilled > 0) {
                xml = fillResult.xml;
                stats.tablesFilled++;
                stats.rowsInserted += fillResult.rowsFilled;
                logger.info(`宽松匹配填充成功: tableIndex=${loose.tableIndex}, section=${section.id}`);
              } else {
                logger.warn(`宽松匹配成功但填充0行: tableIndex=${loose.tableIndex}, section=${section.id}`);
              }
            } else {
              logger.warn(`表头匹配全部失败（精确+宽松）: section=${section.id}, 表头=${dt.headers?.join(',')}, 表格将被跳过`);
            }
          }
        }
      }

      stats.chaptersCopied++;
      } catch (sectionErr: any) {
        logger.error(`section ${section.id} (tableIndex=${tableIndex}) 处理失败: ${sectionErr.message}`);
        warnings.push(`section ${section.id} 处理失败: ${sectionErr.message}`);
      }
    }

    await templateService.saveDocumentXml(templateSessionId, xml);

    // 格式校验：对比填充前后文档结构一致性
    const templateEntry = templateService.getSession(templateSessionId);
    let validationPassed = true;
    let validationErrors: string[] = [];

    if (templateEntry?.originalXml) {
      const validation = validateFilledDocument(
        templateEntry.originalXml,
        xml,
        templateEntry.unpackDir
      );
      validationPassed = validation.valid;
      validationErrors = validation.errors;

      if (!validationPassed) {
        logger.error(`格式校验失败: ${validationErrors.join("; ")}`);
        stats.validationPassed = false;

        const failResult: FillResult = {
          success: false,
          outputFileName: "", downloadUrl: "",
          stats: { placeholdersReplaced: stats.placeholdersReplaced, tablesFilled: stats.tablesFilled, rowsInserted: stats.rowsInserted },
          warnings: [...warnings, ...validationErrors],
          error: `格式校验失败: ${validationErrors[0]}`,
          validation: { passed: false, errors: validationErrors, warnings: validation.warnings },
        };
        return { fillResult: failResult, subtreeStats: stats };
      }

      stats.validationPassed = true;
      logger.info("格式校验通过");
    } else {
      logger.warn("无原始 XML 快照，跳过格式校验");
      stats.validationPassed = true;
    }

    const fillResult: FillResult = {
      success: true, outputFileName: "", downloadUrl: "",
      stats: { placeholdersReplaced: stats.placeholdersReplaced, tablesFilled: stats.tablesFilled, rowsInserted: stats.rowsInserted },
      warnings,
      validation: { passed: true, errors: [], warnings: [] },
    };

    logger.info(`V2 填充完成: ${stats.tablesFilled} 表, ${stats.rowsInserted} 行, ${stats.keyValueCellsFilled} KV单元格`);
    return { fillResult, subtreeStats: stats };
  }

  /** 将 DataTable 转为简化 XML（用于表头匹配） */
  private dataTableToXml(dt: DataTable): { xml: string; validGrid?: boolean[][] } {
    const toTc = (text: string) => `<w:tc><w:p><w:r><w:t>${this.escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
    const headerRow = `<w:tr>${dt.headers.map(toTc).join("")}</w:tr>`;
    const validGrid = dt.rows.map(r =>
      dt.headers.map(h => {
        const raw = (r as any)[h] || "";
        return typeof raw === 'string' ? true : (typeof raw === 'object' && 'valid' in raw ? (raw as any).valid : true);
      })
    );
    const hasInvalid = validGrid.some(row => row.some(v => !v));
    const dataRows = dt.rows.map(r =>
      `<w:tr>${dt.headers.map((h) => {
        const raw = (r as any)[h] || "";
        const val = getValidationText(raw as any);
        return toTc(val);
      }).join("")}</w:tr>`
    ).join("");
    return { xml: `<w:tbl>${headerRow}${dataRows}</w:tbl>`, validGrid: hasInvalid ? validGrid : undefined };
  }

  /** 将 KeyValuePair[] 转为简化 XML（用于键值对匹配） */
  private kvToXml(kvPairs: KeyValuePair[]): string {
    const toTc = (text: string) => `<w:tc><w:p><w:r><w:t>${this.escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
    const cells: string[] = [];
    for (const kv of kvPairs) {
      cells.push(toTc(kv.key), toTc(getValidationText(kv.value)));
    }
    // 每 4 个单元格一行
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 4) {
      rows.push(`<w:tr>${cells.slice(i, i + 4).join("")}</w:tr>`);
    }
    return `<w:tbl>${rows.join("")}</w:tbl>`;
  }

  /** XML 字符转义：防止 & < > " 等特殊字符产生非法 XML */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

export const fillerService = new FillerService();
