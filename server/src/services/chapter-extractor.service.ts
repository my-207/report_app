import { logger } from "../utils/logger";
import { docxService } from "./docx.service";
import {
  extractTagContent,
  extractAllTexts,
  findChapterBoundaries,
  findTextPosition,
  isKeyValueTable,
  countKeyValuePairs,
  getRowCells,
} from "../utils/xml-utils";
import {
  Chapter,
  SourceAnalysis,
  BasicInfo,
  TablePreview,
  UnifiedReportData,
  SectionData,
  DataTable,
  KeyValuePair,
  SignatureBlock,
} from "../types";

/** 章节切分器：从原始 MD.docx 中识别章节边界，切分为 Chapter 列表 */
export class ChapterExtractor {
  /**
   * 分析源文档：解压 → 切分章节 → 提取基本信息
   * @param unpackDir 源 docx 的解压目录
   */
  async analyze(unpackDir: string): Promise<SourceAnalysis> {
    const xml = await docxService.readDocumentXml(unpackDir);
    logger.info("源文档分析中...");

    // 1. 识别章节边界
    const boundaries = findChapterBoundaries(xml);
    logger.info(`识别到 ${boundaries.length} 个章节边界`);

    // 2. 切分章节
    const chapters: Chapter[] = [];
    for (let i = 0; i < boundaries.length; i++) {
      const current = boundaries[i];
      const next = boundaries[i + 1];
      const startIndex = current.startIndex;
      const endIndex = next ? next.startIndex : xml.length;

      const xmlContent = xml.substring(startIndex, endIndex);

      // 提取该章节中的段落和表格
      const paragraphs = this.extractParagraphs(xmlContent);
      const tables = this.extractTables(xmlContent);
      const signatureText = this.extractSignature(xmlContent);

      chapters.push({
        id: current.id,
        title: current.title,
        startIndex,
        endIndex,
        xmlContent,
        paragraphs,
        tables,
        signatureText,
      });
    }

    // 3. 从文档开头提取基本信息
    const basicInfo = this.extractBasicInfo(xml);

    const totalTables = chapters.reduce((sum, c) => sum + c.tables.length, 0);

    // 统计键值对表格
    let keyValueTableCount = 0;
    let keyValuePairCount = 0;
    for (const ch of chapters) {
      for (const tbl of ch.tables) {
        if (isKeyValueTable(tbl)) {
          keyValueTableCount++;
          const kv = countKeyValuePairs(tbl);
          keyValuePairCount += kv.pairCount;
        }
      }
    }

    logger.info(
      `源文档分析完成: ${chapters.length} 个章节, ${totalTables} 个表格, ${keyValueTableCount} 个键值对表, ${keyValuePairCount} 个键值对`
    );

    // 4. 构建表格预览
    const tablePreviews = this.buildTablePreviews(chapters);

    return {
      chapters,
      basicInfo,
      totalChapters: chapters.length,
      totalTables,
      keyValueTableCount,
      keyValuePairCount,
      tablePreviews,
    };
  }

  /** 分析源文档为 UnifiedReportData（新统一数据结构） */
  async analyzeToUnified(unpackDir: string): Promise<UnifiedReportData> {
    const xml = await docxService.readDocumentXml(unpackDir);
    logger.info("源文档分析 (Unified)...");

    const boundaries = findChapterBoundaries(xml);
    const basicInfo = this.extractBasicInfo(xml);

    const sections: SectionData[] = [];
    for (let i = 0; i < boundaries.length; i++) {
      const current = boundaries[i];
      const next = boundaries[i + 1];
      const startIndex = current.startIndex;
      const endIndex = next ? next.startIndex : xml.length;
      const xmlContent = xml.substring(startIndex, endIndex);

      // 提取表格数据
      const tables = this.extractTables(xmlContent);
      const dataTables: DataTable[] = [];
      const kvPairs: KeyValuePair[] = [];
      let hasHybrid = false;
      let hybridHeaderRows = 1;

      for (const tblXml of tables) {
        // 混合表检测：一个表格既有 KV 行又有列表行
        const hybrid = detectHybridTable(tblXml);
        if (hybrid) {
          // 提取 Row 0 的键值对
          const kv = extractKvPairRow(tblXml, 0);
          kvPairs.push(...kv);
          // 提取 Row 1+ 的列表数据
          const dt = extractDataTableSkipRows(tblXml, current.id, hybrid.listHeaderEnd);
          if (dt) dataTables.push(dt);
          hasHybrid = true;
          hybridHeaderRows = hybrid.listHeaderEnd;
        } else if (isKeyValueTable(tblXml)) {
          // 提取键值对
          const kv = this.extractKvFromTable(tblXml);
          kvPairs.push(...kv);
        } else {
          // 提取列表型表格
          const dt = this.extractDataTable(tblXml, current.id);
          if (dt) dataTables.push(dt);
        }
      }

      const signatureText = this.extractSignature(xmlContent);
      const signature = this.parseSignatureBlock(signatureText);

      sections.push({
        id: current.id,
        title: current.title,
        kvPairs,
        tables: dataTables,
        signature,
        ...(hasHybrid ? { hasHybridTable: true, hybridListHeaderRows: hybridHeaderRows } : {}),
      });
    }

    logger.info(`源文档分析 (Unified) 完成: ${sections.length} 个章节`);

    return { basicInfo, sections };
  }

  /** 从键值对表格 XML 提取 KeyValuePair[] */
  private extractKvFromTable(tableXml: string): KeyValuePair[] {
    const pairs: KeyValuePair[] = [];
    const trRegex = /<w:tr[ >]/g;
    let tm: RegExpExecArray | null;
    while ((tm = trRegex.exec(tableXml)) !== null) {
      const tr = extractTagContent(tableXml, tm.index, "w:tr");
      if (!tr) continue;
      const cells = getRowCells(tr);
      for (let i = 0; i < cells.length - 1; i += 2) {
        const key = cells[i];
        const value = cells[i + 1];
        if (key && value && !/^\s*X+\s*$/.test(value)) {
          pairs.push({ key, value });
        }
      }
    }
    return pairs;
  }

  /** 从列表型表格 XML 提取 DataTable */
  private extractDataTable(tableXml: string, sectionId: string): DataTable | null {
    const rows2: string[][] = [];
    const trRegex = /<w:tr[ >]/g;
    let tm2: RegExpExecArray | null;
    let isFirst = true;
    while ((tm2 = trRegex.exec(tableXml)) !== null) {
      const tr = extractTagContent(tableXml, tm2.index, "w:tr");
      if (!tr) { isFirst = false; continue; }
      const cells = getRowCells(tr);
      // 跳过签名行
      if (!isFirst && cells.some(c => /检测|校对|审核|检查|审批/.test(c))) continue;
      rows2.push(cells);
      isFirst = false;
    }
    if (rows2.length < 2) return null;
    const headers = rows2[0];
    const dataRows = rows2.slice(1).map(r => {
      const row: Record<string, string> = {};
      for (let i = 0; i < headers.length && i < r.length; i++) {
        row[headers[i]] = r[i];
      }
      return row;
    });
    return { tableType: sectionId, headers, rows: dataRows };
  }

  /** 解析签名文本为 SignatureBlock */
  private parseSignatureBlock(text: string): SignatureBlock {
    const sig: SignatureBlock = { inspectorName: "", inspectorDate: "", checkerName: "", checkerDate: "", reviewerName: "", reviewerDate: "" };
    if (!text) return sig;

    const im = /检测[：:]\s*(.+?)(?:\s*(\d{4}年\d{1,2}月\d{1,2}日))?/.exec(text);
    if (im) { sig.inspectorName = im[1]?.trim() || ""; sig.inspectorDate = im[2] || ""; }

    const cm = /校对[：:]\s*(.+?)(?:\s*(\d{4}年\d{1,2}月\d{1,2}日))?/.exec(text);
    if (cm) { sig.checkerName = cm[1]?.trim() || ""; sig.checkerDate = cm[2] || ""; }

    const rm = /审核[：:]\s*(.+?)(?:\s*(\d{4}年\d{1,2}月\d{1,2}日))?/.exec(text);
    if (rm) { sig.reviewerName = rm[1]?.trim() || ""; sig.reviewerDate = rm[2] || ""; }

    return sig;
  }

  /** 从 XML 片段中提取所有 <w:p> 子树 */
  private extractParagraphs(xmlFragment: string): string[] {
    const paragraphs: string[] = [];
    const pRegex = /<w:p[ >]/g;
    let m: RegExpExecArray | null;
    while ((m = pRegex.exec(xmlFragment)) !== null) {
      const pContent = extractTagContent(xmlFragment, m.index, "w:p");
      if (pContent) paragraphs.push(pContent);
    }
    return paragraphs;
  }

  /** 从 XML 片段中提取所有 <w:tbl> 子树 */
  private extractTables(xmlFragment: string): string[] {
    const tables: string[] = [];
    const tblRegex = /<w:tbl[ >]/g;
    let m: RegExpExecArray | null;
    while ((m = tblRegex.exec(xmlFragment)) !== null) {
      const tblContent = extractTagContent(xmlFragment, m.index, "w:tbl");
      if (tblContent) tables.push(tblContent);
    }
    return tables;
  }

  /**
   * 从 XML 片段中提取签名人名（纯人名，不含日期）
   *
   * 源文档中签名行格式如 "检测：张三 2025年6月23日"，本方法只提取 "张三"。
   * 找不到对应人名时返回空字符串，调用方会跳过填充。
   */
  private extractSignature(xmlFragment: string): string {
    const texts = extractAllTexts(xmlFragment);
    // 按优先级匹配五种签名角色的人名
    const patterns = [
      /检测[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
      /校对[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
      /审核[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
      /检查[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
      /审批[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
    ];

    for (const pattern of patterns) {
      for (const text of texts) {
        const m = pattern.exec(text);
        if (m && m[1].trim()) {
          return m[1].trim();
        }
      }
    }
    return "";
  }

  /**
   * 从文档 XML 中提取 BasicInfo
   *
   * 核心原则：找不到对应数据时返回空字符串，不使用任何 fallback 默认值。
   * 调用方（filler.service）会检查空值并跳过不填充，保留模板原有内容。
   */
  extractBasicInfo(xml: string): BasicInfo {
    const texts = extractAllTexts(xml);
    const allText = texts.join("\n");

    // 提取管线名称（第一行通常是管线名）
    const pipeLineName = texts[0] || "";

    // 提取报告编号：支持真实编号（如 GGW-2024-03001-2024）和 X 占位符格式
    const reportMatch = allText.match(/[A-Z]{2,}-\d+-\d+-20\d{2}/);
    const reportNumber = reportMatch ? reportMatch[0] : "";

    // 提取单位名称：查找 "公司" 结尾的中文名
    const companyMatch = allText.match(/([\u4e00-\u9fa5]{2,20})公司/);
    const companyName = companyMatch ? companyMatch[1] + "公司" : "";

    // 设备名称：优先匹配"管道名称"/"管线名称"/"设备名称"，回退到第一行文本
    const deviceMatch = allText.match(/(?:管道名称|管线名称|设备名称)[：:]\s*([^\n]+)/);
    const deviceName = deviceMatch ? deviceMatch[1].trim() : (texts[0] || "");

    // 报告类型前缀：从报告编号提取，找不到返回空
    const prefixMatch = reportNumber.match(/^([A-Z]+)/);
    const reportTypePrefix = prefixMatch ? prefixMatch[1] : "";

    // 提取日期范围
    const dates = this.extractDates(allText);

    return {
      reportNumber,
      companyName,
      deviceName,
      reportTypePrefix,
      inspectionStartDate: dates.start || "",
      inspectionEndDate: dates.end || "",
      inspectorDate: dates.inspector || "",
      checkerDate: dates.checker || "",
      reviewerDate: dates.reviewer || "",
    };
  }

  /** 从文本中提取各类日期 */
  private extractDates(text: string): {
    start?: string;
    end?: string;
    inspector?: string;
    checker?: string;
    reviewer?: string;
  } {
    const result: Record<string, string> = {};

    // 提取签名行日期：检测/校对/审核
    const sigPattern = /检测[：:]?\s*[^2]*?(\d{4}年\d{1,2}月\d{1,2}日).*?校对[：:]?\s*[^2]*?(\d{4}年\d{1,2}月\d{1,2}日)/;
    const sigMatch = text.match(sigPattern);
    if (sigMatch) {
      result.inspector = sigMatch[1];
      result.checker = sigMatch[2];
    }

    // 审核日期
    const reviewPattern = /审核[：:]?\s*[^2]*?(\d{4}年\d{1,2}月\d{1,2}日)/;
    const reviewMatch = text.match(reviewPattern);
    if (reviewMatch) {
      result.reviewer = reviewMatch[1];
    }

    // 所有完整日期列表
    const allDates = text.match(/\d{4}年\d{1,2}月\d{1,2}日/g) || [];

    // 起止日期：优先匹配明确的日期范围（如 "2024年6月-2024年7月"）
    const rangeMatch = text.match(/(\d{4}年\d{1,2}月)\s*[至到\-\–]\s*(\d{4}年\d{1,2}月)/);
    if (rangeMatch) {
      result.start = rangeMatch[1];
      result.end = rangeMatch[2];
    } else if (allDates.length >= 2) {
      // 回退：取最早和最晚的完整日期
      result.start = allDates[0]!;
      result.end = allDates[allDates.length - 1]!;
    }

    return result;
  }

  /**
   * 从章节的 Word XML 表格中构建 TablePreview 数据
   * 遍历所有章节中的列表型表格（跳过键值对表），提取表头和全部数据行
   */
  private buildTablePreviews(chapters: Chapter[]): TablePreview[] {
    const previews: TablePreview[] = [];

    for (const ch of chapters) {
      for (let ti = 0; ti < ch.tables.length; ti++) {
        const tbl = ch.tables[ti];
        if (isKeyValueTable(tbl)) continue; // 跳过键值对表

        // 提取表格中所有行
        const rows: string[] = [];
        const trRegex = /<w:tr[ >]/g;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRegex.exec(tbl)) !== null) {
          const tr = extractTagContent(tbl, trMatch.index, "w:tr");
          if (tr) rows.push(tr);
        }

        if (rows.length < 2) continue; // 至少需要表头+1行数据

        // 检测表头区域（含 w:vMerge 或 w:gridSpan 的行属于合并表头）
        let headerEnd = 1;
        for (let i = 0; i < rows.length - 1; i++) {
          const hasVMerge = /<w:vMerge\b/.test(rows[i]);
          const hasGridSpan = /<w:gridSpan\b/.test(rows[i]);
          if (i === 0 || hasVMerge || hasGridSpan) {
            headerEnd = i + 1;
          } else {
            break;
          }
        }

        // 用最后一行表头作为 headers
        const headerCells = getRowCells(rows[headerEnd - 1]);
        const headers = headerCells.filter(c => c.length > 0);

        // 提取数据行（表头之后，排除签名行）
        const dataRows: string[][] = [];
        const dataEnd = rows.length - 1; // 最后一行通常是签名行，排除
        for (let i = headerEnd; i < dataEnd; i++) {
          const cells = getRowCells(rows[i]);
          // 跳过空行
          if (cells.every(c => !c)) continue;
          dataRows.push(cells);
        }

        if (dataRows.length === 0) continue;

        previews.push({
          sectionId: ch.id,
          entityType: `表格${ti + 1}`,
          headers,
          rowCount: dataRows.length,
          sampleRows: dataRows,
        });
      }
    }

    return previews;
  }
}

/** 检测表格是否为混合 KV+List 类型（Row 0 KV + Row 1+ List） */
function detectHybridTable(tableXml: string): { listHeaderEnd: number } | null {
  const trRegex = /<w:tr[ >]/g;
  const rows: string[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = trRegex.exec(tableXml)) !== null) {
    const tr = extractTagContent(tableXml, tm.index, "w:tr");
    if (tr) rows.push(tr);
  }
  if (rows.length < 4) return null; // 至少需要 KV行 + header + data + sig

  const row0Cells = getRowCells(rows[0]).filter(t => t && t.length < 50);
  const row1Cells = getRowCells(rows[1]).filter(t => t && t.length < 50);

  // Row 0: 偶数位短标签 + 奇数位有值 → KV 模式
  let kvPairs = 0;
  for (let i = 0; i < row0Cells.length - 1; i += 2) {
    const label = row0Cells[i];
    const value = row0Cells[i + 1];
    if (label && label.length > 0 && label.length < 15 && !/^\d+$/.test(label)
        && value && value.length > 0 && !/^\s*$/.test(value)) {
      kvPairs++;
    }
  }

  // Row 1: 多个等宽列名 → 列表表头模式
  if (row0Cells.length >= 6 && row1Cells.length >= 3
      && row0Cells.length !== row1Cells.length && kvPairs >= 3) {
    // 检测列表表头是否有多层
    let listHeaderEnd = 1;
    if (rows.length >= 3 && row1Cells.length <= 3) {
      const row2Cells = getRowCells(rows[2]).filter(t => t && t.length < 50);
      if (row2Cells.length >= 4 && row2Cells.length > row1Cells.length) {
        listHeaderEnd = 2;
      }
    }
    return { listHeaderEnd };
  }
  return null;
}

/** 从表格 XML 中提取指定行的键值对（偶数位=key, 奇数位=value） */
function extractKvPairRow(tableXml: string, rowIndex: number): KeyValuePair[] {
  const pairs: KeyValuePair[] = [];
  const trRegex = /<w:tr[ >]/g;
  let tm: RegExpExecArray | null;
  let ri = 0;
  while ((tm = trRegex.exec(tableXml)) !== null) {
    if (ri > rowIndex) break;
    const tr = extractTagContent(tableXml, tm.index, "w:tr");
    if (!tr) { ri++; continue; }
    if (ri === rowIndex) {
      const cells = getRowCells(tr);
      for (let i = 0; i < cells.length - 1; i += 2) {
        const key = cells[i];
        const value = cells[i + 1];
        if (key && !/^\d+$/.test(key) && key.length < 50) {
          pairs.push({ key, value: value || "" });
        }
      }
    }
    ri++;
  }
  return pairs;
}

/** 从表格 XML 提取列表数据，跳过前 skipRows 行 */
function extractDataTableSkipRows(
  tableXml: string, sectionId: string, skipRows: number
): DataTable | null {
  const allRows: string[][] = [];
  const trRegex = /<w:tr[ >]/g;
  let tm2: RegExpExecArray | null;
  let ri2 = 0;
  while ((tm2 = trRegex.exec(tableXml)) !== null) {
    const tr = extractTagContent(tableXml, tm2.index, "w:tr");
    if (!tr) { ri2++; continue; }
    const cells = getRowCells(tr);
    if (ri2 >= skipRows) {
      allRows.push(cells);
    }
    ri2++;
  }

  if (allRows.length < 2) return null;

  // 过滤签名行
  const filtered = allRows.filter((_, idx) => {
    if (idx === allRows.length - 1) {
      return !allRows[allRows.length - 1].some(c => /检测|校对|审核|检查|审批/.test(c));
    }
    return true;
  });

  if (filtered.length < 2) return null;

  const headers = filtered[0];
  const dataRows = filtered.slice(1).map(r => {
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length && i < r.length; i++) {
      row[headers[i]] = r[i];
    }
    return row;
  });

  return { tableType: sectionId, headers, rows: dataRows };
}

export const chapterExtractor = new ChapterExtractor();
