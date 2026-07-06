/**
 * XML 工具模块 — 从 filler.service.ts 和 template.service.ts 提取的公共方法
 * 核心能力：标签提取、文本提取、章节边界识别
 */

/** 从指定位置提取 XML 标签的完整内容（处理嵌套和属性） */
export function extractTagContent(xml: string, startPos: number, tagName: string): string | null {
  const openPattern = new RegExp("<" + tagName + "[ >]", "g");
  const closeTag = "</" + tagName + ">";
  const closeLen = closeTag.length;

  let depth = 1;
  let pos = startPos;
  const tagEnd = xml.indexOf(">", pos);
  if (tagEnd === -1) return null;
  pos = tagEnd + 1;

  while (pos < xml.length - closeLen) {
    openPattern.lastIndex = pos;
    const nextOpenMatch = openPattern.exec(xml);
    const nextOpen = nextOpenMatch ? nextOpenMatch.index : -1;
    const nextClose = xml.indexOf(closeTag, pos);

    if (nextClose === -1) return null;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      const end = xml.indexOf(">", nextOpen);
      pos = end !== -1 ? end + 1 : nextOpen + tagName.length + 3;
    } else {
      depth--;
      if (depth === 0) {
        return xml.substring(startPos, nextClose + closeLen);
      }
      pos = nextClose + closeLen;
    }
  }

  return null;
}

/** 提取 XML 中所有纯文本（仅 <w:t> 内容，不含 XML 标签碎片） */
export function extractAllTexts(xml: string): string[] {
  const texts: string[] = [];
  const wtRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = wtRegex.exec(xml)) !== null) {
    const t = m[1].trim();
    if (t && !t.startsWith("<") && t.length < 200) {
      texts.push(t);
    }
  }
  return texts;
}

/** 查找 XML 中所有指定标签的位置和内容 */
export function findAllTags(xml: string, tagName: string): Array<{ index: number; content: string }> {
  const results: Array<{ index: number; content: string }> = [];
  const openRegex = new RegExp("<" + tagName + "[ >]", "g");
  let m: RegExpExecArray | null;
  while ((m = openRegex.exec(xml)) !== null) {
    const content = extractTagContent(xml, m.index, tagName);
    if (content) {
      results.push({ index: m.index, content });
    }
  }
  return results;
}

/** 通过章节编号模式识别章节边界 */
export function findChapterBoundaries(xml: string): Array<{ id: string; title: string; startIndex: number }> {
  const chapters: Array<{ id: string; title: string; startIndex: number }> = [];
  const wtRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
  let m: RegExpExecArray | null;

  // 匹配章节编号模式，支持两种格式：
  //   重复编号: （1-1）（1-1）原始资料审查报告
  //   单编号:   （1-1）原始资料审查报告
  const doublePattern = /[（(]?\s*(\d+[-－]\d+)\s*[）)]?\s*[（(]?\s*\1\s*[）)]?\s*(.+)/;
  const singlePattern = /[（(]\s*(\d+[-－]\d+)\s*[）)]\s*(.+)/;

  while ((m = wtRegex.exec(xml)) !== null) {
    const text = m[1].trim();
    let cm = text.match(doublePattern);
    if (!cm) {
      cm = text.match(singlePattern);
    }
    if (cm) {
      const id = cm[1];
      const title = text.substring(0, 100); // 截断过长标题
      // 避免重复（同一章节编号只取第一个出现位置）
      if (!chapters.find(c => c.id === id)) {
        chapters.push({ id, title, startIndex: m.index });
      }
    }
  }

  return chapters;
}

/** 在 XML 中查找包含指定文本的第一个 <w:t> 位置 */
export function findTextPosition(xml: string, searchText: string): number {
  const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("<w:t\\b[^>]*>" + escaped + "<\\/w:t>", "g");
  const m = regex.exec(xml);
  return m ? m.index : -1;
}

/** 提取从指定位置到下一个章节边界之间的 XML 片段 */
export function extractChapterXml(xml: string, startIndex: number, nextChapterStartIndex?: number): string {
  if (nextChapterStartIndex !== undefined && nextChapterStartIndex > startIndex) {
    return xml.substring(startIndex, nextChapterStartIndex);
  }
  return xml.substring(startIndex);
}

/** 提取 <w:t> 文本内容（纯文本，不含标签） */
export function extractWtTexts(wtXml: string): string[] {
  const texts: string[] = [];
  const regex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(wtXml)) !== null) {
    const t = m[1].trim();
    if (t && !t.startsWith("<") && t.length < 50) texts.push(t);
  }
  return texts;
}

/**
 * 提取 XML 片段中每个单元格的合并文本
 * 用于表头匹配前将 Word XML 中被拆分为多个 <w:t> 的文本（如"序"+"号"→"序号"）合并
 */
export function getCellMergedTexts(rowXml: string): string[] {
  const cells: string[] = [];
  const tcRegex = /<w:tc[ >]/g;
  let tcMatch: RegExpExecArray | null;
  while ((tcMatch = tcRegex.exec(rowXml)) !== null) {
    const tc = extractTagContent(rowXml, tcMatch.index, "w:tc");
    if (tc) {
      const wtRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
      let wtMatch: RegExpExecArray | null;
      const parts: string[] = [];
      while ((wtMatch = wtRegex.exec(tc)) !== null) {
        const t = wtMatch[1].trim();
        if (t && !t.startsWith("<")) parts.push(t);
      }
      cells.push(parts.join(""));
    }
  }
  return cells;
}

/** 获取行的单元格文本列表 */
export function getRowCellTexts(rowXml: string): string[] {
  return extractWtTexts(rowXml);
}

/**
 * 从 w:tr XML 中提取每个 w:tc 单元格的纯文本
 * 与 getRowCellTexts 不同，本方法逐单元格提取，保证单元格与列对齐
 */
export function getRowCells(rowXml: string): string[] {
  const cells: string[] = [];
  const tcRegex = /<w:tc[ >]/g;
  let tcMatch: RegExpExecArray | null;
  while ((tcMatch = tcRegex.exec(rowXml)) !== null) {
    const tc = extractTagContent(rowXml, tcMatch.index, "w:tc");
    if (tc) {
      const texts = extractWtTexts(tc);
      cells.push(texts.join("") || "");
    }
  }
  return cells;
}

/** 判断行是否为空 */
export function isRowEmpty(rowXml: string): boolean {
  const texts = extractWtTexts(rowXml);
  return texts.every(t => !t);
}

/** 单元格分析信息 */
export interface CellInfo {
  /** 单元格合并后的纯文本 */
  text: string;
  /** gridSpan 跨列数（默认1） */
  gridSpan: number;
  /** vMerge 状态 */
  vMerge: 'none' | 'restart' | 'continue';
  /** 是否为空单元格 */
  isEmpty: boolean;
  /** 该单元格原始物理索引（在行中的第几个 <w:tc>） */
  physicalIndex: number;
}

/** 行分析结果 */
export interface RowAnalysis {
  /** 该行的所有单元格信息 */
  cells: CellInfo[];
  /** 逻辑列总数（gridSpan 展开后） */
  logicalColCount: number;
  /** 物理单元格数 */
  physicalCellCount: number;
  /** 是否为签名行（含检测/校对/审核/检查/审批 锚点） */
  isSignatureRow: boolean;
  /** 是否为KV模式行（偶数位标签+奇数位值交替） */
  isKvRow: boolean;
  /** 是否为列表表头行（所有单元格都有文本） */
  isHeaderRow: boolean;
  /** 是否为合并标题行（gridSpan覆盖大部分列） */
  isMergeTitleRow: boolean;
}

/**
 * 逐单元格分析行结构
 * 
 * 逐个解析每个 <w:tc> 的 gridSpan/vMerge 属性，展开为逻辑列数组，
 * 同时判断行的类型（KV行/列表头/签名行/合并标题行）。
 * 
 * @param rowXml w:tr 的 XML 内容
 * @returns RowAnalysis 行分析结果
 */
export function analyzeRowCells(rowXml: string): RowAnalysis {
  const cells: CellInfo[] = [];
  
  const tcRegex = /<w:tc[ >]/g;
  let tcMatch: RegExpExecArray | null;
  let physIdx = 0;
  
  while ((tcMatch = tcRegex.exec(rowXml)) !== null) {
    const tc = extractTagContent(rowXml, tcMatch.index, "w:tc");
    if (!tc) continue;
    
    // 提取文本
    const wtRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
    const parts: string[] = [];
    let wtMatch: RegExpExecArray | null;
    while ((wtMatch = wtRegex.exec(tc)) !== null) {
      const t = wtMatch[1].trim();
      if (t && !t.startsWith("<")) parts.push(t);
    }
    const text = parts.join("");
    
    // gridSpan
    const gsMatch = /<w:gridSpan\s+w:val="(\d+)"/.exec(tc);
    const gridSpan = gsMatch ? parseInt(gsMatch[1], 10) : 1;
    
    // vMerge 状态
    let vMerge: 'none' | 'restart' | 'continue' = 'none';
    if (/<w:vMerge\s*\/>/.test(tc) || /<w:vMerge\s+w:val="continue"/.test(tc)) {
      vMerge = 'continue';
    } else if (/<w:vMerge\s+w:val="restart"/.test(tc)) {
      vMerge = 'restart';
    }
    
    cells.push({
      text,
      gridSpan,
      vMerge,
      isEmpty: !text || /^\s*$/.test(text),
      physicalIndex: physIdx,
    });
    
    physIdx++;
  }
  
  // 逻辑列总数（gridSpan 展开）
  const logicalColCount = cells.reduce((sum, c) => sum + c.gridSpan, 0);
  
  // 拼接所有文本用于行类型判断
  const allText = cells.map(c => c.text).join("");
  
  // 签名行检测
  const isSignatureRow = /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(allText);
  
  // KV行检测：偶数位(标签)有短文本 + 奇数位(值)为空或含占位符
  // 排除签名行和表头行
  // 注意：必须用物理单元格数配对，而不是逻辑列数。
  // 因为 gridSpan 标签（如 gridSpan=2 的"管道编号"）会让逻辑列数为奇数（如5），
  // 但物理单元格数仍为偶数（4=2对KV），应正确识别为KV行。
  // 排除条件：如果行同时满足 isHeaderRow（大部分单元格非空）和 isKvRow 条件，
  // 优先判定为表头行（如表头行"序号|管段起止位置|管段长度|检测指标|防腐层等级"）
  let isKvRow = false;
  if (!isSignatureRow && cells.length >= 4 && cells.length % 2 === 0) {
    let labelCount = 0;
    let emptyValueCount = 0;
    // 排除常见列表头关键词
    const listKw = new Set(["序号", "编号", "检验项目", "检查项目", "检查内容", "检查结果", "备注", "日期", "处理措施"]);
    // 按物理单元格配对：cells[0]=标签1, cells[1]=值1, cells[2]=标签2, cells[3]=值2...
    for (let i = 0; i < cells.length - 1; i += 2) {
      const label = cells[i].text;
      const value = cells[i + 1].text || "";
      // 标签有效性：非空、短文本、非纯数字、非纯符号(//-—)、非列表头关键词
      const isValidLabel = label && label.length > 0 && label.length < 50
        && !/^\d+$/.test(label)
        && !/^[\/\-—－_]+$/.test(label.trim())
        && !listKw.has(label);
      if (isValidLabel) {
        labelCount++;
        if (!value || /^\s*$/.test(value) || /^[\/\-—]+$/.test(value)) {
          emptyValueCount++;
        }
      }
    }
    // 至少2个标签 + 至少一半值列为空 → KV行
    isKvRow = labelCount >= 2 && emptyValueCount >= labelCount / 2;
  }

  // 表头行检测：所有单元格（排除vMerge continue）都有非空文本
  const headerCells = cells.filter(c => c.vMerge !== 'continue');
  const nonEmptyHeaders = headerCells.filter(c => !c.isEmpty);
  const isHeaderRow = nonEmptyHeaders.length >= 3 && nonEmptyHeaders.length >= headerCells.length * 0.7;

  // 表头行优先：如果行同时满足 isKvRow 和 isHeaderRow（大部分单元格非空），
  // 优先判定为表头行而非KV行。
  // 表头行特征：大部分单元格都有文本（列名），KV行特征：值列为空（待填）。
  // 如"序号|管段起止位置|管段长度|检测指标|防腐层等级"会被误判为KV行，
  // 但它实际是表头行（所有单元格非空）。
  if (isKvRow && isHeaderRow) {
    isKvRow = false;
  }
  
  // 合并标题行：gridSpan 覆盖大量列（≥4）且物理单元格少（≤4）
  // 放宽条件：WPS中合并标题行可能含序号/页码单元格（如"243防腐（保温）层检查"有4格）
  // 排除签名行：含"检测：/校对：/审核："等关键词的行不算合并标题行
  const maxGridSpan = Math.max(...cells.map(c => c.gridSpan));
  const fullRowText = cells.map(c => c.text).join('');
  const hasSignatureKeyword = /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(fullRowText);
  const isMergeTitleRow = maxGridSpan >= 4 && cells.length <= 4 && !hasSignatureKeyword;
  
  return {
    cells,
    logicalColCount,
    physicalCellCount: cells.length,
    isSignatureRow,
    isKvRow,
    isHeaderRow,
    isMergeTitleRow,
  };
}

/**
 * 判断表格 XML 是否为键值对类型
 *
 * 键值对表格：每行是 "标签 | 值 | 标签 | 值" 交替排列。
 * 列表型表格：第一行全是列标题，奇数位也有独立列名。
 *
 * 增强判断：不再严格要求值列为空。
 * 只要偶数位（标签位）有足够数量的独立标签文本，且标签文本与值文本语义不同（短标签 vs 长内容），即视为键值对表。
 * 额外检查：如果偶数位文本长度是奇数位文本的 3 倍以上（标签很短），则强烈认为是键值对表。
 */
// 常见表头关键词——若首行的偶数位包含这些词，优先判定为列表型表格
// 整格匹配：避免子串误判（如"管道编号"不应匹配"编号"）
const LIST_HEADER_KEYWORDS = [
  "序号", "编号", "检验项目", "检查项目", "检查内容", "检查结果",
  "页码", "附图", "备注", "日期", "检测结果", "处理措施",
  "事件类型", "位置", "深度", "壁厚", "规格型号",
];
export function isKeyValueTable(tableXml: string): boolean {
  // 提取表格所有行
  const allRows = findAllTags(tableXml, "w:tr");
  if (allRows.length === 0) return false;

  // 检测 row 0 是否为合并标题行（≤2 个 cell），如果是则从 row 1 开始扫描
  let startRowIdx = 0;
  if (allRows.length > 1) {
    const row0Cells = getCellMergedTexts(allRows[0].content);
    // 合并标题行：≤2 个单元格 → 跳过
    // 但如果是 ≥3 个单元格的首行，需进一步判断是否为列表表头
    if (row0Cells.length <= 2) {
      startRowIdx = 1; // 跳过合并标题行，直接从数据行开始判断
    } else if (row0Cells.length >= 3) {
      // 首行有 ≥3 个非空单元格 → 检查是否为列表表头
      // 列表表头的特征：大部分单元格是非空短文本 + 包含表头关键词
      const nonEmptyCount = row0Cells.filter(c => c && c.trim().length > 0).length;
      const hasListKeyword = row0Cells.some(c => LIST_HEADER_KEYWORDS.includes(c.trim()));
      if (nonEmptyCount >= row0Cells.length * 0.75 && hasListKeyword) {
        // 首行大部分单元格非空 + 包含列表表头关键词 → 列表型表格，不是KV
        return false;
      }
    }
  }

  if (startRowIdx >= allRows.length) return false;

  // 当 Row 0 被跳过（合并标题行）时，检查 startRowIdx 行是否为列表表头
  if (startRowIdx > 0 && startRowIdx < allRows.length) {
    const startRowCells = getCellMergedTexts(allRows[startRowIdx].content);
    if (startRowCells.length >= 3) {
      const nonEmptyCount = startRowCells.filter(c => c && c.trim().length > 0).length;
      const hasListKeyword = startRowCells.some(c => LIST_HEADER_KEYWORDS.includes(c.trim()));
      if (nonEmptyCount >= startRowCells.length * 0.75 && hasListKeyword) {
        return false; // 列表型表格
      }
    }
  }

  // 多行扫描（至多 3 行），累积 KV 模式证据
  let labelCount = 0;
  let valueTextCount = 0;
  let labelTotalLen = 0;
  let valueTotalLen = 0;
  let totalRowsScanned = 0;

  const rowsToCheck = Math.min(allRows.length - startRowIdx, 3);
  for (let r = startRowIdx; r < startRowIdx + rowsToCheck; r++) {
    const cells = getCellMergedTexts(allRows[r].content);
    totalRowsScanned++;

    // 遍历该行所有列（偶数位=标签，奇数位=值）
    for (let i = 0; i < cells.length - 1; i += 2) {
      const labelCell = cells[i];
      const valueCell = cells[i + 1];
      // 过滤掉纯数字标签（如年份 2025）和过长的标签（非键名）
      if (labelCell && labelCell.length > 0 && !/^\d+$/.test(labelCell) && labelCell.length < 50) {
        labelCount++;
        labelTotalLen += labelCell.length;
      }
      if (valueCell && valueCell.length > 0 && !/^\s*$/.test(valueCell)) {
        valueTextCount++;
        valueTotalLen += valueCell.length;
      }
    }
  }

  // 至少要有 2 个标签才可能是 KV 表
  if (labelCount < 2) return false;

  // 策略 1: 所有值列为空 → 明确是键值对表（模板占位待填）
  if (valueTextCount === 0) return true;

  // 策略 2: 值列有内容但标签文本远短于值文本（标签短 vs 值长）→ 键值对表
  if (labelCount > 0 && valueTextCount > 0) {
    const avgLabelLen = labelTotalLen / labelCount;
    const avgValueLen = valueTotalLen / valueTextCount;
    if (avgLabelLen < 10 && avgValueLen > avgLabelLen * 1.5) {
      return true;
    }
  }

  // 策略 3: 标签数量 >= 4 且至少一半值列为空 → 很可能是键值对
  if (labelCount >= 4 && valueTextCount <= labelCount / 2) {
    return true;
  }

  return false;
}

/**
 * 判断表格是否为嵌套键值对表
 *
 * 嵌套KV表特征：Row 0 看似列表表头（≥3 个非空单元格 + 含列表关键词），
 * 但后续数据行中包含大量 vMerge（垂直合并）或 gridSpan（水平合并）特征。
 *
 * 判定条件（满足任一）：
 *   1) 数据行 vMerge 占比 > 25% 且 平均每行数据格数 > 表头格数
 *   2) 数据行中非首列 gridSpan 单元格 ≥ 4
 *
 * 扫描范围：Row 1 ~ Row min(8, totalRows-1)
 */
export function isNestedKvTable(tableXml: string): boolean {
  const allRows = findAllTags(tableXml, "w:tr");
  // 同步Python: 要求 len(rows) > 4（至少5行）
  if (allRows.length <= 4) return false;

  // Row 0 必须看起来像列表表头
  const row0Cells = getCellMergedTexts(allRows[0].content);
  if (row0Cells.length < 3) return false;
  const nonEmptyCount = row0Cells.filter(c => c && c.trim().length > 0).length;
  const hasListKeyword = row0Cells.some(c => LIST_HEADER_KEYWORDS.includes(c.trim()));
  if (!(nonEmptyCount >= row0Cells.length * 0.75 && hasListKeyword)) return false;

  // 排除宽列表型表：列数≥5 且含列表关键词 → 纯列表型表，不是嵌套KV
  if (row0Cells.length >= 5 && hasListKeyword) {
    return false;
  }

  // 扫描后续数据行（最多 8 行），统计 vMerge 和 gridSpan
  const maxDataRows = Math.min(allRows.length - 1, 8);
  let vmergeCount = 0;
  let totalDataCells = 0;
  let gridSpanNonFirstCount = 0;

  for (let r = 1; r <= maxDataRows; r++) {
    const rowAnalysis = analyzeRowCells(allRows[r].content);
    totalDataCells += rowAnalysis.cells.length;

    for (let ci = 0; ci < rowAnalysis.cells.length; ci++) {
      const cell = rowAnalysis.cells[ci];
      if (cell.vMerge !== 'none') {
        vmergeCount++;
      }
      // 同步Python: 非首列（ci > 0）且有 gridSpan >= 2 且有非空文本
      if (cell.gridSpan >= 2 && ci > 0 && !cell.isEmpty) {
        gridSpanNonFirstCount++;
      }
    }
  }

  // 条件 1：vMerge 占比 > 25% 且 平均每行数据格数 > 表头格数
  if (totalDataCells > 8) { // 同步Python: 至少采样了足够多的单元格
    const vmergeRatio = vmergeCount / totalDataCells;
    const avgDataCellsPerRow = totalDataCells / maxDataRows;
    if (vmergeRatio > 0.25 && avgDataCellsPerRow > row0Cells.length) {
      return true;
    }
  }

  // 条件 2：非首列有内容的 gridSpan 单元格 ≥ 4
  if (gridSpanNonFirstCount >= 4) {
    return true;
  }

  return false;
}

/**
 * 从键值对表格 XML 中统计键值对数量
 * 返回 { pairCount: 键值对总数（标签列数）, cellCount: 可填充的空值单元格数 }
 *
 * pairCount: 所有有标签文本的键值对总数（无论 Value 是否为空）
 * cellCount: Value 单元格为空的键值对数量（表示可被数据填充）
 */
export function countKeyValuePairs(tableXml: string): { pairCount: number; cellCount: number } {
  let pairCount = 0;
  let cellCount = 0;

  const trRegex = /<w:tr[ >]/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(tableXml)) !== null) {
    const tr = extractTagContent(tableXml, trMatch.index, "w:tr");
    if (!tr) continue;

    const cells: string[] = [];
    const tcRegex = /<w:tc[ >]/g;
    let tcMatch: RegExpExecArray | null;
    while ((tcMatch = tcRegex.exec(tr)) !== null) {
      const tc = extractTagContent(tr, tcMatch.index, "w:tc");
      if (tc) {
        const wtMatch = /<w:t\b[^>]*>(.*?)<\/w:t>/.exec(tc);
        cells.push(wtMatch ? wtMatch[1].trim() : "");
      }
    }

    for (let i = 0; i < cells.length - 1; i += 2) {
      const labelCell = cells[i];
      const valueCell = cells[i + 1];
      if (labelCell && labelCell.length > 0) {
        pairCount++;
        if (!valueCell || /^\s*$/.test(valueCell)) {
          cellCount++; // 空值单元格，可被填充
        }
      }
    }
  }

  return { pairCount, cellCount };
}
