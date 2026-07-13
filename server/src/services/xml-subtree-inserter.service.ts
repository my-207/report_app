import { logger } from "../utils/logger";
import {
  extractTagContent,
  extractWtTexts,
  isRowEmpty,
  getCellMergedTexts,
} from "../utils/xml-utils";

/**
 * XML 子树插入引擎
 *
 * 核心原则（样式隔离）：
 * - 只复制源文档的 <w:t> 文本内容
 * - 完全保留模板的格式（字体、字号、颜色、边框、列宽等）
 * - 模板 XML 结构不增不减，只在现有结构中替换文本
 */

export class XmlSubtreeInserter {
  /**
   * 将源表格的数据行填入模板表格
   * 策略：匹配表头 → 提取源表格每行的单元格文本 → 填入模板空行
   * 模板格式完全不变，只替换 <w:t> 内容
   * @param signatureText 章节级签名文本（用于填充表格最后一行签名模板）
   */
  fillTableFromSource(
    targetXml: string,
    targetTableIndex: number,
    sourceTableXml: string,
    signatureText: string = "",
    dataStartRow: number = 0,
    signatureBlock?: { inspectorName?: string; inspectorDate?: string; checkerName?: string; checkerDate?: string; reviewerName?: string; reviewerDate?: string },
    validGrid?: boolean[][]
  ): { xml: string; rowsFilled: number } {
    // 1. 在 targetXml 中定位目标表格
    const tblRegex = /<w:tbl[ >]/g;
    let tblMatch: RegExpExecArray | null;
    let tblIdx = 0;

    while ((tblMatch = tblRegex.exec(targetXml)) !== null) {
      if (tblIdx !== targetTableIndex) {
        tblIdx++;
        continue;
      }

      const targetTbl = extractTagContent(targetXml, tblMatch.index, "w:tbl");
      if (!targetTbl) break;

      // 2. 提取源表格的数据行和签名行
      const { dataRows, signatureRow } =
        this.extractTableDataRows(sourceTableXml);

      // 如果源表格没有数据行，跳过不填充，保留模板原样
      if (dataRows.length === 0) {
        logger.info("源表格无数据行，跳过填充");
        return { xml: targetXml, rowsFilled: 0 };
      }

      // 3. 在模板表格中找到所有行
      const targetRows = this.extractAllRows(targetTbl);

      if (targetRows.length < 3) {
        // 模板至少需要：表头 + 1个数据行模板 + 签名行
        logger.warn("模板表格行数不足（需≥3行），无法按新模式填充");
        return { xml: targetXml, rowsFilled: 0 };
      }

      // 4. 智能识别表头区域：通过检测 w:vMerge 属性判断合并表头行
      //    模板中常见结构：
      //      行1: 大标题行（跨多列合并） → 可能有 w:gridSpan
      //      行2: 子表头行（列名）        → 可能有 w:vMerge w:val="restart" 或 "continue"
      //      行3+: 数据行
      //      最后行: 签名行
      //    策略：从 dataStartRow 开始扫描，连续检测到包含 w:vMerge 的行都属于表头区域
      //    dataStartRow 之前的行被保留为 preserved 区（用于混合表中的 KV 行）

      // 收集 dataStartRow 之前的行作为保留区
      const preservedRows: string[] = [];
      for (let i = 0; i < dataStartRow && i < targetRows.length; i++) {
        preservedRows.push(targetRows[i].xml);
      }

      const headerRows: string[] = [];
      let headerEndIndex = dataStartRow;
      for (let i = dataStartRow; i < targetRows.length - 1; i++) {
        const row = targetRows[i];
        const hasVMerge = /<w:vMerge\b/.test(row.xml);
        const hasGridSpan = /<w:gridSpan\b/.test(row.xml);
        const cellCount = (row.xml.match(/<w:tc[ >]/g) || []).length;
        const firstHeaderCellCount = headerRows.length > 0
          ? (headerRows[0].match(/<w:tc[ >]/g) || []).length
          : cellCount;
        // 起始行总是表头
        // 后续行属于表头的条件:
        //   a) 含 vMerge (合并表头延续)
        //   b) 含 gridSpan 且单元格数 < 首行单元格数 (合并标题行, 如跨列大标题)
        //   c) 含 gridSpan 且单元格数 ≤ 首行单元格数（如"检测指标(三者选其一)"合并行）
        // 注意: 数据行可能也有gridSpan(单元格属性), 但单元格数与表头一致, 不应判为表头
        const isMergeTitleRow = hasGridSpan && cellCount <= firstHeaderCellCount;
        if (i === dataStartRow || hasVMerge || isMergeTitleRow) {
          headerRows.push(row.xml);
          headerEndIndex = i + 1;
        } else {
          break;
        }
      }

      // 多层表头修复：vMerge/gridSpan 循环若停留在合并标题行区域，
      // 后续的列名行（无合并属性但单元格数多）也应纳入表头不被覆盖。
      // 循环扩展：直到遇到单元格数与最后表头行相同或更少的行（数据行特征）
      while (headerEndIndex < targetRows.length - 1 && headerRows.length > 0) {
        const lastHeaderCellCount = (headerRows[headerRows.length - 1].match(/<w:tc[ >]/g) || []).length;
        const nextRow = targetRows[headerEndIndex];
        const nextRowCellCount = (nextRow.xml.match(/<w:tc[ >]/g) || []).length;
        const nextHasVMerge = /<w:vMerge\b/.test(nextRow.xml);
        // 列名行特征：单元格数 ≥3 且 > 最后表头行单元格数（合并标题行扩展出更多列）
        if (nextRowCellCount >= 3 && nextRowCellCount > lastHeaderCellCount) {
          headerRows.push(nextRow.xml);
          headerEndIndex++;
          logger.info(`多层表头扩展: ${lastHeaderCellCount}格 → ${nextRowCellCount}格, 表头区=${headerRows.length}行`);
        } else if (nextHasVMerge) {
          // vMerge 延续行也纳入表头
          headerRows.push(nextRow.xml);
          headerEndIndex++;
        } else {
          break;
        }
      }
      // 如果所有非签名行都是表头（异常），至少保留起始行作为表头
      if (headerEndIndex >= targetRows.length - 1) {
        headerEndIndex = dataStartRow + 1;
        headerRows.length = 1;
        headerRows[0] = targetRows[dataStartRow].xml;
      }

      const headerRowXml = headerRows.join(""); // 所有表头行（保留不变）

      // 签名行验证：检测最后一行是否含签名关键词（检测：/校对：/审核：/检查：/审批：）
      // 不含签名关键词的最后一行是数据行（如附页表的"8安全保护装置检验"），不应排除
      const lastRowXml = targetRows[targetRows.length - 1].xml;
      const lastRowTexts = this.getAllWtText(lastRowXml);
      const hasSignatureRow = /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(lastRowTexts);
      const signatureTemplate = hasSignatureRow ? lastRowXml : "";

      // 模板的数据行（表头之后 ~ 倒数第2行或最后一行），跳过表头和签名行
      let templateDataRows = hasSignatureRow
        ? targetRows.slice(headerEndIndex, targetRows.length - 1)
        : targetRows.slice(headerEndIndex);

      // 过滤结论行（≤2物理格 + gridSpan总和≥6）：这些是"结论："等结构性行，
      // 不应作为数据行模板被填充，否则第二组数据会填入1格gridSpan=N的行 → 整行合并成1个单元格。
      // 将结论行保留到 preservedAfterData，在组装时插入数据行与签名行之间。
      const preservedAfterData: string[] = [];
      templateDataRows = templateDataRows.filter(row => {
        const cellCount = (row.xml.match(/<w:tc[ >]/g) || []).length;
        if (cellCount <= 2) {
          // 计算总逻辑列数 = 各格gridSpan之和（无gridSpan属性默认1）
          const gsMatches = [...row.xml.matchAll(/<w:gridSpan\s+w:val="(\d+)"/g)];
          const totalGridSpan = gsMatches.reduce((s, m) => s + parseInt(m[1], 10), 0)
            + (cellCount - gsMatches.length);
          if (totalGridSpan >= 6) {
            preservedAfterData.push(row.xml);
            return false; // 从数据行模板中移除
          }
        }
        return true;
      });

      logger.info(
        `表格行结构: ${targetRows.length}行, 保留${preservedRows.length}行, 表头${headerRows.length}行, 数据模板${templateDataRows.length}行, 结论行${preservedAfterData.length}行, 签名${hasSignatureRow ? 1 : 0}行`
      );

      const filledDataRows: string[] = [];

      // 列数匹配诊断：比较源数据列数与模板数据行列数
      if (dataRows.length > 0 && templateDataRows.length > 0) {
        const srcColCount = dataRows[0].length;
        const tplColCount = (templateDataRows[0].xml.match(/<w:tc[ >]/g) || []).length;
        if (srcColCount !== tplColCount) {
          logger.warn(
            `列数不匹配: 源数据=${srcColCount}列, 模板=${tplColCount}列。` +
            `可能导致部分单元格为空。`
          );
        }
      }

      for (let i = 0; i < Math.max(templateDataRows.length, dataRows.length); i++) {
        const rowValidFlags = validGrid && i < validGrid.length ? validGrid[i] : undefined;
        if (i < dataRows.length && i < templateDataRows.length) {
          // 源有数据 + 模板有空行 → 填入
          filledDataRows.push(
            this.fillRowWithData(templateDataRows[i].xml, dataRows[i], rowValidFlags)
          );
        } else if (i < templateDataRows.length) {
          // 源无更多数据但模板还有空行 → 保留模板空行原样
          filledDataRows.push(templateDataRows[i].xml);
        } else {
          // 源数据超出模板行数 → 用模板第一行数据格式克隆追加
          // 关键：移除 vMerge restart 属性，避免克隆行与原行发生垂直合并
          const clonedRow = this.cleanVMergeFromRow(templateDataRows[0].xml);
          filledDataRows.push(
            this.fillRowWithData(clonedRow, dataRows[i], rowValidFlags)
          );
        }
      }

      // 填充签名行：优先用 signatureBlock 直接填充，其次源表格签名行，最后章节级 signatureText
      // 无签名行时（hasSignatureRow=false）跳过签名填充
      let filledSignatureRow = "";
      let hasDateToFill = false;
      if (hasSignatureRow) {
        if (signatureBlock && (signatureBlock.inspectorName || signatureBlock.checkerName || signatureBlock.reviewerName)) {
          // 直接用 SignatureBlock 填充：逐格插入姓名和替换日期占位符
          // fillSignatureRowDirect 已逐格处理日期，无需后续全局清除
          filledSignatureRow = this.fillSignatureRowDirect(signatureTemplate, signatureBlock);
          hasDateToFill = false; // 逐格已处理，不再全局清除
        } else if (signatureRow) {
          const expandedSigData = this.expandSignatureRow(signatureRow);
          filledSignatureRow = this.fillRowWithData(signatureTemplate, expandedSigData);
          hasDateToFill = expandedSigData.some(v => /年月日/.test(v) && /\d{4}年/.test(v));
        } else if (signatureText && signatureText.trim()) {
          // 从章节级 signatureText 提取角色信息
          const chapterSigCells = this.expandSignatureRow([signatureText]);
          filledSignatureRow = this.fillRowWithData(signatureTemplate, chapterSigCells);
        } else {
          filledSignatureRow = signatureTemplate;
        }
        // 仅 signatureRow 回退路径需要全局清除残余占位符
        // fillSignatureRowDirect 路径已逐格处理
        if (hasDateToFill) {
          filledSignatureRow = this.replaceDatePlaceholders(filledSignatureRow);
          filledSignatureRow = this.trimSpacesBeforeDate(filledSignatureRow);
        }
      }

      // 5. 组装完整表格 XML
      // 保留原表格的 w:tblPr（表格属性）和 w:tblGrid（网格定义）等非行元素
      const tblWrapper = this.getTableWrapper(targetTbl);
      const rebuiltTbl =
        tblWrapper.prefix +
        preservedRows.join("") +
        headerRowXml +
        filledDataRows.join("") +
        preservedAfterData.join("") +
        filledSignatureRow +
        tblWrapper.suffix;

      const newXml =
        targetXml.substring(0, tblMatch.index) +
        rebuiltTbl +
        targetXml.substring(tblMatch.index + targetTbl.length);

      return { xml: newXml, rowsFilled: dataRows.length };
    }

    return { xml: targetXml, rowsFilled: 0 };
  }

  /** 提取源表格中所有数据行的单元格文本，分离数据行和签名行 */
  private extractTableDataRows(tableXml: string): {
    dataRows: string[][];
    signatureRow: string[] | null;
  } {
    const rows: string[][] = [];
    const trRegex = /<w:tr[ >]/g;
    let trMatch: RegExpExecArray | null;
    let isFirst = true;
    let firstRowCellCount = 0;
    let headerSkipCount = 0;

    while ((trMatch = trRegex.exec(tableXml)) !== null) {
      const tr = extractTagContent(tableXml, trMatch.index, "w:tr");
      if (!tr) continue;

      if (isFirst) {
        isFirst = false;
        // 记录第一行的单元格数，用于判断是否为合并标题行
        firstRowCellCount = (tr.match(/<w:tc[ >]/g) || []).length;
        headerSkipCount = 1;
        // 如果第一行是合并标题行（≤2个cell），第二行（列名行）也需跳过
        if (firstRowCellCount <= 2) {
          headerSkipCount = 2;
        }
        continue; // 跳过表头行
      }

      // 跳过合并标题行后的第二行（列名行）
      if (headerSkipCount > 1) {
        headerSkipCount--;
        continue;
      }

      // 提取每个单元格的文本
      const cells = this.extractCellTexts(tr);
      if (cells.length > 0) rows.push(cells);
    }

    // 判断最后一行是否为签名行（包含检测/校对/审核/检查/审批关键词 + 冒号）
    // 注意: 必须带冒号，避免误判含"检测位置"等普通数据的行为签名行
    const signatureKeywords = /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/;
    let signatureRow: string[] | null = null;
    let dataRows = rows;

    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1];
      const isSignature = lastRow.some(
        (cell) => cell && signatureKeywords.test(cell)
      );
      if (isSignature) {
        dataRows = rows.slice(0, -1);
        signatureRow = lastRow;
      }
    }

    return { dataRows, signatureRow };
  }

  /** 提取行中每个 <w:tc> 的文本（拼接多run单元格的所有 <w:t> 文本） */
  private extractCellTexts(rowXml: string): string[] {
    const cells: string[] = [];
    const tcRegex = /<w:tc[ >]/g;
    let tcMatch: RegExpExecArray | null;

    while ((tcMatch = tcRegex.exec(rowXml)) !== null) {
      const tc = extractTagContent(rowXml, tcMatch.index, "w:tc");
      if (tc) {
        cells.push(this.getAllWtText(tc));
      }
    }

    return cells;
  }

  /** 提取模板表格中所有行 */
  private extractAllRows(tableXml: string): Array<{ xml: string; isEmpty: boolean }> {
    const rows: Array<{ xml: string; isEmpty: boolean }> = [];
    const trRegex = /<w:tr[ >]/g;
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trRegex.exec(tableXml)) !== null) {
      const tr = extractTagContent(tableXml, trMatch.index, "w:tr");
      if (tr) {
        rows.push({ xml: tr, isEmpty: isRowEmpty(tr) });
      }
    }

    return rows;
  }

  /**
   * 提取表格的非行部分（w:tblPr、w:tblGrid 等），返回 prefix 和 suffix。
   * 这样重建表格时可以保留表格属性、列宽定义等结构。
   */
  private getTableWrapper(tableXml: string): {
    prefix: string;
    suffix: string;
  } {
    // 找到第一个 <w:tr 和最后一个 </w:tr>，中间是行，前后是非行部分
    const firstTrMatch = /<w:tr[ >]/.exec(tableXml);
    if (!firstTrMatch) return { prefix: "", suffix: "" };

    // 找到最后一个 </w:tr>
    const lastTrEnd = tableXml.lastIndexOf("</w:tr>");
    if (lastTrEnd === -1) return { prefix: "", suffix: "" };

    const prefix = tableXml.substring(0, firstTrMatch.index);
    const suffix = tableXml.substring(lastTrEnd + "</w:tr>".length);

    return { prefix, suffix };
  }

  /**
   * 清除行 XML 中的 vMerge restart 属性
   * 用于克隆数据行时，避免克隆行与原行发生垂直合并
   * 将 <w:vMerge w:val="restart"/> 和 <w:vMerge w:val="restart" /> 移除
   * 将 <w:vMerge/> （无 val 属性的 restart）也移除
   */
  private cleanVMergeFromRow(rowXml: string): string {
    return rowXml
      .replace(/<w:vMerge\s+w:val="restart"\s*\/>/g, '')
      .replace(/<w:vMerge\s+\/>/g, '');
  }

  /** 用数据填充模板行（只替换 <w:t> 文本，保留格式） */
  private fillRowWithData(templateRowXml: string, data: string[], validFlags?: boolean[]): string {
    // 填充前诊断
    const preTcOpen = (templateRowXml.match(/<w:tc[ >]/g) || []).length;
    const preTcClose = (templateRowXml.match(/<\/w:tc>/g) || []).length;
    if (preTcOpen !== preTcClose) {
      logger.warn(`fillRowWithData 填充前已存在标签不配对: <w:tc>=${preTcOpen}, </w:tc>=${preTcClose}, data=[${data.join('|')}]`);
    }

    // 先收集所有单元格的位置和内容（在原 rowXml 中的绝对索引）
    const tcMatches: Array<{ index: number; content: string }> = [];
    const tcRegex = /<w:tc[ >]/g;
    let tcMatch: RegExpExecArray | null;
    while ((tcMatch = tcRegex.exec(templateRowXml)) !== null) {
      const tc = extractTagContent(templateRowXml, tcMatch.index, "w:tc");
      if (tc) {
        tcMatches.push({ index: tcMatch.index, content: tc });
      }
    }

    // 构建逻辑列到物理单元格的映射，跳过 vMerge continue 单元格
    // gridSpan 单元格占多列，vMerge continue 单元格属于上一行不填数据
    const logicalToPhysical: number[] = []; // logicalCol -> tcMatches index
    let logicalCol = 0;
    for (let physIdx = 0; physIdx < tcMatches.length; physIdx++) {
      const tc = tcMatches[physIdx].content;
      // vMerge continue: 跳过（该单元格是上一行合并的延续，不应填充数据）
      const isVMergeContinue = /<w:vMerge\s*\/>/.test(tc) || /<w:vMerge\s+w:val="continue"/.test(tc);
      if (isVMergeContinue) {
        // 不分配逻辑列，直接跳过
        continue;
      }
      // gridSpan: 该单元格占据多列，所有被占逻辑列都映射到此物理单元格
      const gridSpanMatch = /<w:gridSpan\s+w:val="(\d+)"/.exec(tc);
      const span = gridSpanMatch ? parseInt(gridSpanMatch[1], 10) : 1;
      for (let s = 0; s < span; s++) {
        logicalToPhysical[logicalCol] = physIdx;
        logicalCol++;
      }
    }

    // 从后往前替换，避免索引偏移
    // 关键：gridSpan > 1 时多个逻辑列映射到同一物理单元格，只处理一次
    let filled = templateRowXml;
    const processedPhysIdx = new Set<number>();

    // 检测数据格式：data.length < logicalCol → 紧凑格式（非展开，每物理格一个值）
    //               data.length >= logicalCol → 展开格式（含gridSpan重复）
    if (data.length > 0 && data.length < logicalCol) {
      // 紧凑格式：从后往前填以避免XML索引偏移。若数据数小于物理格数，在尾部补空值使首格不被跳过
      const fillableCount = tcMatches.filter((_, pi) => {
        const tc = tcMatches[pi].content;
        return !(/<w:vMerge\s*\/>/.test(tc) || /<w:vMerge\s+w:val="continue"/.test(tc));
      }).length;
      const paddedData: string[] = data.length < fillableCount
        ? [...data, ...Array(fillableCount - data.length).fill("")]
        : data;
      const paddedFlags: boolean[] | undefined = validFlags && validFlags.length < fillableCount
        ? [...validFlags, ...Array(fillableCount - validFlags.length).fill(true)]
        : validFlags;

      let dataIdx = paddedData.length - 1;
      for (let physIdx = tcMatches.length - 1; physIdx >= 0; physIdx--) {
        if (dataIdx < 0) break;
        const tc = tcMatches[physIdx].content;
        const isVMergeContinue = /<w:vMerge\s*\/>/.test(tc) || /<w:vMerge\s+w:val="continue"/.test(tc);
        if (isVMergeContinue) continue;
        const value = paddedData[dataIdx];
        const isInvalid = paddedFlags && dataIdx < paddedFlags.length ? !paddedFlags[dataIdx] : false;
        dataIdx--;
        if (!value) continue;
        if (processedPhysIdx.has(physIdx)) continue;
        const newTc = this.injectTextIntoCell(tcMatches[physIdx].content, value, isInvalid);
        processedPhysIdx.add(physIdx);
        filled = filled.substring(0, tcMatches[physIdx].index) + newTc + filled.substring(tcMatches[physIdx].index + tcMatches[physIdx].content.length);
      }
    } else {
      // 展开格式：data[li] 对应逻辑列 li，按gridSpan映射到物理单元格
      for (let li = logicalToPhysical.length - 1; li >= 0; li--) {
        if (li >= data.length) continue;
        const value = data[li];
        if (!value) continue; // 空值跳过，保留模板原样

        const physIdx = logicalToPhysical[li];
        if (physIdx === undefined || physIdx >= tcMatches.length) continue;
        if (processedPhysIdx.has(physIdx)) continue;

        const isInvalid = validFlags && li < validFlags.length ? !validFlags[li] : false;
        const tc = tcMatches[physIdx];
        const newTc = this.injectTextIntoCell(tc.content, value, isInvalid);
        processedPhysIdx.add(physIdx);

        filled =
          filled.substring(0, tc.index) +
          newTc +
          filled.substring(tc.index + tc.content.length);
      }
    }

    // 填充后诊断
    const postTcOpen = (filled.match(/<w:tc[ >]/g) || []).length;
    const postTcClose = (filled.match(/<\/w:tc>/g) || []).length;
    if (postTcOpen !== postTcClose) {
      logger.warn(`fillRowWithData 填充后标签不配对: <w:tc>=${postTcOpen}, </w:tc>=${postTcClose}, data=[${data.join('|')}]`);
    }

    return filled;
  }

  /**
   * 向单元格注入文本 —— 兼容三种模板格式:
   * 1. 有完整 <w:t>...</w:t> 标签 → 正则替换内容
   * 2. 有 <w:t 开头但无 </w:t> 闭合（WPS空cell常见格式）→ 补全闭合标签并写入
   * 3. 无 <w:t> 标签的空cell（只有 <w:p><w:pPr/></w:p>）→ 自动补全 run 结构再写入
   *
   * 某些 WPS 制作的模板中，空单元格缺少完整的 <w:r><w:t/></w:r> 文本 run，
   * 导致原有正则无法匹配，数据无法写入。
   */
  private injectTextIntoCell(cellXml: string, text: string, highlight = false): string {
    // 黄色背景：在 <w:rPr> 中注入 <w:highlight w:val="yellow"/>
    let xml = cellXml;
    if (highlight) {
      if (/<w:rPr\b/.test(xml)) {
        // 已有 <w:rPr>，在其内部追加 w:highlight
        xml = xml.replace(
          /<w:rPr\b([^>]*)>/g,
          (match) => {
            if (match.includes('w:highlight')) return match;
            return match.replace(/\/?>$/, '') + '><w:highlight w:val="yellow"/>';
          }
        );
      } else {
        // 无 <w:rPr>，在第一个 <w:r> 开始标签后补全
        xml = xml.replace(
          /(<w:r\b[^>]*>)/,
          '$1<w:rPr><w:highlight w:val="yellow"/></w:rPr>'
        );
      }
    }

    const hasOpenTag = /<w:t\b/.test(xml);
    const hasCloseTag = /<\/w:t>/.test(xml);

    // 情况1: 有完整的 <w:t>...</w:t> 标签 → 正则替换
    if (hasOpenTag && hasCloseTag) {
      return xml.replace(
        /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/,
        (_m, p1: string, _p2: string, p3: string) => p1 + this.escapeXml(text) + p3
      );
    }

    // 情况2: 有 <w:t 开头但无 </w:t> 闭合 → 需特殊处理防止吃掉 </w:r> 等结构标签
    if (hasOpenTag && !hasCloseTag) {
      // 2a) 自闭合 <w:t ... /> → 展开为 <w:t ...>text</w:t>，保持外围结构不变
      if (/<w:t[^>]*\/>/.test(xml)) {
        return xml.replace(
          /(<w:t\b[^>]*)\/>/,
          (_m, p1: string) => p1 + ">" + this.escapeXml(text) + "</w:t>"
        );
      }
      // 2b) 非自闭合但缺 </w:t> → 用 </w:r> 或 </w:p> 作为闭合边界，避免 [^]* 吃掉结构标签
      return xml.replace(
        /(<w:t\b[^>]*>)([^]*?)(<\/w:r>|<\/w:p>)/,
        (_m, p1: string, _p2: string, p3: string) => p1 + this.escapeXml(text) + "</w:t>" + p3
      );
    }

    // 情况3: 完全无 <w:t> 标签 → 注入完整 run 结构
    // 从 <w:pPr> 继承字体属性（保证格式一致性）
    const rPrMatch = /<w:rPr(?:\s[^>]*)?>.*?<\/w:rPr>/s.exec(xml);
    let inheritedRPr = rPrMatch ? rPrMatch[0] : "<w:rPr/>";
    // 确保rPr包含rFonts字体属性（宋体），否则填充文字可能使用文档默认字体
    if (!/<w:rFonts\b/.test(inheritedRPr)) {
      inheritedRPr = inheritedRPr.replace(
        /<w:rPr\b([^>]*)>/,
        '<w:rPr$1><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体"/>'
      );
    }
    const runXml = `<w:r>${inheritedRPr}<w:t xml:space="preserve">${this.escapeXml(text)}</w:t></w:r>`;

    // 在 </w:pPr> 之后、</w:p> 之前插入 run
    if (/<\/w:pPr>/.test(xml)) {
      return xml.replace("</w:pPr>", `</w:pPr>${runXml}`);
    } else if (/<(w:p)[ >]/.test(xml)) {
      // 没有 pPr 时，在第一个 <w:p> 开始标签后插入
      return xml.replace(/(<w:p[ >][^>]*>)/, `$1${runXml}`);
    }
    // 兜底：直接追加到 cell 末尾前
    return xml.replace(/(<\/w:tc>)$/, `${runXml}$1`);
  }

  /** 获取默认行模板（用于追加新行） */
  private getDefaultRow(tableXml: string): string {
    const rows = this.extractAllRows(tableXml);
    return rows.length > 0 ? rows[rows.length - 1].xml : "";
  }

  /**
   * 键值对表格填充：从模板表格提取标签Key，到源表格找对应Value，填入模板空单元格。
   *
   * 适用场景：管道参数表、设备信息表等 "标签 | 值 | 标签 | 值" 交替排列的键值对表格。
   *
   * 核心原则：
   * - 模板格式完全不变，只替换 <w:t> 文本
   * - 按表格区分 Key，不跨表混淆
   * - 源表格无对应 Key 则跳过，保留模板原样
   */
  fillKeyValueTable(
    targetXml: string,
    targetTableIndex: number,
    sourceTableXml: string,
    kvPairs?: { key: string; value: string | { value: string; valid: boolean; reason?: string } }[]
  ): { xml: string; cellsFilled: number } {
    // 1. 定位模板中的目标表格
    const tblRegex = /<w:tbl[ >]/g;
    let tblMatch: RegExpExecArray | null;
    let tblIdx = 0;

    while ((tblMatch = tblRegex.exec(targetXml)) !== null) {
      if (tblIdx !== targetTableIndex) {
        tblIdx++;
        continue;
      }

      const targetTbl = extractTagContent(targetXml, tblMatch.index, "w:tbl");
      if (!targetTbl) break;

      // 2. 从源表格提取键值对 Map
      const sourceKvMap = this.extractKeyValuePairs(sourceTableXml);
      if (sourceKvMap.size === 0) {
        logger.info("源表格无键值对数据，跳过键值对填充");
        return { xml: targetXml, cellsFilled: 0 };
      }

      // 2b. 构建校验未通过的key集合，用于填充时加黄色背景
      const invalidKeys = new Set<string>();
      if (kvPairs) {
        for (const kv of kvPairs) {
          const valid = typeof kv.value === 'string' ? true : kv.value.valid;
          if (!valid) invalidKeys.add(kv.key);
        }
      }

      // 3. 遍历模板表格的每一行，查找标签Key并填充
      let cellsFilled = 0;
      let rebuiltTbl = targetTbl;

      const targetRows = this.extractAllRows(targetTbl);
      for (const row of targetRows) {
        const filledRow = this.fillKeyValueRow(row.xml, sourceKvMap, invalidKeys);
        if (filledRow.xml !== row.xml) {
          rebuiltTbl = rebuiltTbl.replace(row.xml, filledRow.xml);
          cellsFilled += filledRow.cellsFilled;
        }
      }

      // 4. 组装回完整 XML
      const newXml =
        targetXml.substring(0, tblMatch.index) +
        rebuiltTbl +
        targetXml.substring(tblMatch.index + targetTbl.length);

      return { xml: newXml, cellsFilled };
    }

    return { xml: targetXml, cellsFilled: 0 };
  }

  /**
   * 从表格 XML 中提取键值对 Map
   * 表格结构如: 标签1 | 值1 | 标签2 | 值2（每行两对键值）
   * 返回 Map: { "标签1" → "值1", "标签2" → "值2", ... }
   */
  private extractKeyValuePairs(tableXml: string): Map<string, string> {
    const map = new Map<string, string>();
    const rows = this.extractAllRows(tableXml);

    for (const row of rows) {
      const cells = this.extractCellTexts(row.xml);
      // 键值对表格：偶数位置是Key，奇数位置是Value
      for (let i = 0; i < cells.length - 1; i += 2) {
        const key = cells[i];
        const value = cells[i + 1];
        // 只记录有效的 Key-Value 对（Key 非空，Value 非空且不含 X 占位符）
        if (key && value && !/^\s*X+\s*$/.test(value)) {
          map.set(key, value);
        }
      }
    }

    return map;
  }

  /**
   * 在一行中查找标签Key并填充对应空单元格
   *
   * 模板行结构：标签1 | [空] | 标签2 | [空]
   * 逻辑：遍历单元格，找到已知Key标签 → 其相邻空单元格填入源文档Value
   *
   * 返回修改后的行XML和填充单元格数
   */
  private fillKeyValueRow(
    rowXml: string,
    sourceKvMap: Map<string, string>,
    invalidKeys: Set<string> = new Set()
  ): { xml: string; cellsFilled: number } {
    let resultXml = rowXml;
    let cellsFilled = 0;

    // 整行提取（使用 getCellMergedTexts 与 analyze() 保持 100% 一致）
    const rowCells = getCellMergedTexts(rowXml);

    // 定位行内所有单元格（记录在原 rowXml 中的绝对索引，用于 XML 替换定位）
    const tcMatches: Array<{ index: number; content: string }> = [];
    const tcRegex = /<w:tc[ >]/g;
    let tcMatch: RegExpExecArray | null;
    while ((tcMatch = tcRegex.exec(rowXml)) !== null) {
      const tc = extractTagContent(rowXml, tcMatch.index, "w:tc");
      if (tc) {
        tcMatches.push({ index: tcMatch.index, content: tc });
      }
    }

    // 动态扫描：遍历每个单元格作为潜在标签，找到已知Key → 填充相邻空单元格
    // 使用 i-- (而非 i-=2) 逐位扫描，自动适应合并单元格导致的配对偏移:
    //   - 标准KV行: [标签1, 值1, 标签2, 值2] → 标签在偶数位
    //   - 合并首列行: [类别(continue), 标签1, 值1, 标签2, 值2] → 标签在奇数位
    // "下一个单元格必须为空" 的守卫条件防止值单元格被误判为标签
    // 从后往前填充，避免索引偏移影响后续替换
    //
    // 注意: 已移除 skipFirstCol 逻辑。原逻辑对所有 vMerge 首格统一跳过，
    // 导致 vMerge restart 行的有效标签（如"管道级别"）无法填充。
    // i-- 扫描 + "下一格必须为空"守卫已覆盖所有场景:
    //   - 类别列(如"性能参数"): 下一格"管道长度"非空 → 自然跳过
    //   - vMerge restart key(如"管道级别"): 下一格空 → 正确填充
    //   - vMerge continue: 无文本(labelText为空) → 自然跳过

    for (let i = tcMatches.length - 2; i >= 0; i--) {
      const valueTc = tcMatches[i + 1];

      // 使用 getCellMergedTexts 结果取标签（与 analyze 阶段一致）
      const labelText = i < rowCells.length ? rowCells[i] : "";
      if (!labelText) continue;

      // 在源Map中查找对应Value
      const sourceValue = sourceKvMap.get(labelText);
      if (!sourceValue) continue;

      // 检查待填充单元格是否为空（只填充空单元格，不覆盖已有内容）
      const valueText = (i + 1) < rowCells.length ? rowCells[i + 1] : "";
      if (valueText && !/^\s*$/.test(valueText)) {
        // 该单元格已有非空内容 → 跳过（保留模板原样或已填充数据）
        continue;
      }

      // 填充：使用 injectTextIntoCell 处理有/无 <w:t> 两种情况
      // 若该 key 对应的值未通过校验，单元格加黄色背景
      const needsHighlight = invalidKeys.has(labelText);
      const newTc = this.injectTextIntoCell(valueTc.content, sourceValue, needsHighlight);

      // 精确索引替换（从后往前，不受前面替换影响）
      resultXml =
        resultXml.substring(0, valueTc.index) +
        newTc +
        resultXml.substring(valueTc.index + valueTc.content.length);
      cellsFilled++;
    }

    // 填充后诊断
    const kvPostTcOpen = (resultXml.match(/<w:tc[ >]/g) || []).length;
    const kvPostTcClose = (resultXml.match(/<\/w:tc>/g) || []).length;
    if (kvPostTcOpen !== kvPostTcClose) {
      const kvPreTcOpen = (rowXml.match(/<w:tc[ >]/g) || []).length;
      const kvPreTcClose = (rowXml.match(/<\/w:tc>/g) || []).length;
      logger.warn(`fillKeyValueRow 标签不配对: 填充前 <w:tc>=${kvPreTcOpen}/${kvPreTcClose}, 填充后 <w:tc>=${kvPostTcOpen}/${kvPostTcClose}, cellsFilled=${cellsFilled}`);
    }

    return { xml: resultXml, cellsFilled };
  }

  /**
   * 将源签名行文本按角色展开为多列数据
   *
   * 源签名行通常是一个单元格包含 "检测：张三 2025年6月23日"，
   * 但模板签名行将各角色分在不同列中（如 检测 | 日期 | 校对 | 日期）。
   * 本方法将紧凑格式展开为多列数组，便于 fillRowWithData 逐列填入。
   */
  private expandSignatureRow(signatureRow: string[]): string[] {
    // 将所有单元格文本拼接为一个完整字符串
    const sigFullText = signatureRow.join("");

    // 提取检测信息
    const inspectorName = /检测[：:]\s*(.+?)(?:\s*\d{4}年|$)/.exec(sigFullText)?.[1]?.trim() || "";
    const inspectorDate = /检测[：:].*?(\d{4}年\d{1,2}月\d{1,2}日)/.exec(sigFullText)?.[1]?.trim() || "";

    // 提取校对信息
    const checkerName = /校对[：:]\s*(.+?)(?:\s*\d{4}年|$)/.exec(sigFullText)?.[1]?.trim() || "";
    const checkerDate = /校对[：:].*?(\d{4}年\d{1,2}月\d{1,2}日)/.exec(sigFullText)?.[1]?.trim() || "";

    // 提取审核信息
    const reviewerName = /审核[：:]\s*(.+?)(?:\s*\d{4}年|$)/.exec(sigFullText)?.[1]?.trim() || "";
    const reviewerDate = /审核[：:].*?(\d{4}年\d{1,2}月\d{1,2}日)/.exec(sigFullText)?.[1]?.trim() || "";

    // 按模板常见的列结构组装：检测：人名 | 日期 | 校对：人名 | 日期 | 审核：人名 | 日期
    return [
      "检测：" + inspectorName, inspectorDate,
      "校对：" + checkerName, checkerDate,
      "审核：" + reviewerName, reviewerDate,
    ];
  }

  /** 清除 XML 中未被替换的日期占位符 */
  private replaceDatePlaceholders(xml: string): string {
    // 策略1: 单 run 日期占位符（按匹配度从具体到通用排列，优先匹配更具体的模式）
    let result = xml
      .replace(/20\dX年\d{1,2}月\d{1,2}日/g, "")  // 年份含X但月日已确定（如202X年6月17日）
      .replace(/20\dX年X月XX日/g, "")               // 全占位符年月日
      .replace(/20XX年XX月XX日/g, "")                // 备用全X占位
      .replace(/20\d{2}X年\d{1,2}月\d{1,2}日/g, ""); // 年份部分含X月日确定（如2025X年6月17日）

    // 策略2: 多 run 日期占位符（日期被拆分到多个 <w:t>，如 "202""X""年""6""月""17""日"）
    // 安全处理：逐个 <w:t> 检查，如果文本仅含日期字符（数字/X/年/月/日），清空其内容
    // 这种方式不会破坏 <w:r> 结构
    const allWtRegex = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
    result = result.replace(allWtRegex, (fullMatch, text) => {
      const trimmed = text.trim();
      // 只清空纯日期片段（如 "202", "X", "年", "6", "月", "XX", "日"）
      if (trimmed && /^[\dX年月日]+$/.test(trimmed) && (/[\dX]/.test(trimmed) || /^[年月日]$/.test(trimmed))) {
        // 检查上下文：只在签名行中清空（避免误清正常日期）
        // 简单策略：如果片段含 X 占位符，或纯数字且长度<=4，视为日期占位符片段
        if (/X/.test(trimmed) || /^\d{1,4}$/.test(trimmed) || /^[年月日]$/.test(trimmed)) {
          // 安全替换：用 split/join 避免 text 中的特殊字符被当作正则模式
          const openTagEnd = fullMatch.indexOf('>') + 1;
          const closeTagStart = fullMatch.lastIndexOf('</w:t>');
          const openTag = fullMatch.substring(0, openTagEnd);
          return openTag + '</w:t>';
        }
      }
      return fullMatch;
    });

    return result;
  }

  /**
   * 清理签名行中人名和日期之间的多余空格
   * WPS签名行中"检测：张三                                  202X年..." 填入姓名后导致换行
   * 策略：用正则一步替换，在姓名后的纯空格 <w:t> 中删除5个空格字符
   * 安全实现：只修改纯空格 <w:t> 的文本内容，不改变 XML 结构
   */
  private trimSpacesBeforeDate(xml: string): string {
    // 匹配：姓名文本 → 纯空格<w:t>（1个或多个）→ 日期<w:t>
    // 在纯空格<w:t>中删除5个空格字符
    // 用函数替换避免 $1 后跟数字的解析问题
    return xml.replace(
      /(<w:t\b[^>]*>(?:[^<]*[^\s<][^<]*)<\/w:t>)([\s\S]*?)(<w:t\b[^>]*>)(\s+)(<\/w:t>)([\s\S]*?<w:t\b[^>]*>[\s\S]*?[年月日][\s\S]*?<\/w:t>)/g,
      (_match, beforeText: string, gap1: string, openTag: string, spaces: string, closeTag: string, afterPart: string) => {
        // 只删除5个空格
        if (spaces.length <= 5) {
          // 空格不足5个，全部删除
          return beforeText + gap1 + openTag + '' + closeTag + afterPart;
        }
        return beforeText + gap1 + openTag + spaces.substring(0, spaces.length - 5) + closeTag + afterPart;
      }
    );
  }

  /**
   * 直接用 SignatureBlock 填充签名行
   * 策略：在模板的"检测：""校对：""审核："锚点后插入姓名，替换日期占位符
   * 适配多种签名行结构（1列/2列/4列，gridSpan合并等）
   * 关键：WPS 模板中"检测："后通常跟空格，且日期被拆分到多个 <w:t> run
   */
  private fillSignatureRowDirect(
    signatureRowXml: string,
    sig: { inspectorName?: string; inspectorDate?: string; checkerName?: string; checkerDate?: string; reviewerName?: string; reviewerDate?: string }
  ): string {
    let result = signatureRowXml;

    // 先收集单元格数量
    const tcCount = (signatureRowXml.match(/<w:tc[ >]/g) || []).length;

    // 从前往后处理每个单元格，每次修改后重新收集后续单元格位置
    // （避免从后往前时长度变化导致索引错位）
    for (let ci = 0; ci < tcCount; ci++) {
      // 重新在当前 result 中查找单元格（因为前面的修改可能改变了位置）
      const tcRegexRe = /<w:tc[ >]/g;
      let tcMatchRe: RegExpExecArray | null;
      let reIdx = 0;
      while ((tcMatchRe = tcRegexRe.exec(result)) !== null) {
        if (reIdx === ci) break;
        reIdx++;
      }
      if (!tcMatchRe) break;
      
      const tc = extractTagContent(result, tcMatchRe.index, "w:tc");
      if (!tc) continue;
      let newTc = tc;

      // 获取该单元格所有 <w:t> 文本的拼接
      const allText = this.getAllWtText(newTc);

      // 确定该单元格对应哪个角色（检测/校对/审核）
      let role: { name?: string; date?: string; anchors: string[] } | null = null;
      if (/检测[：:]/.test(allText) || /检查[：:]/.test(allText)) {
        role = { name: sig.inspectorName, date: sig.inspectorDate, anchors: ["检测：", "检测:", "检查：", "检查:"] };
      } else if (/校对[：:]/.test(allText)) {
        role = { name: sig.checkerName, date: sig.checkerDate, anchors: ["校对：", "校对:"] };
      } else if (/审核[：:]/.test(allText) || /审批[：:]/.test(allText)) {
        role = { name: sig.reviewerName, date: sig.reviewerDate, anchors: ["审核：", "审核:", "审批：", "审批:"] };
      }

      if (!role) continue;

      // 1. 插入姓名：在锚点后直接插入姓名
      //    WPS 格式多样:
      //    a) <w:t>检测：   </w:t> (锚点+空格)
      //    b) <w:t>检测：   ...202</w:t> (锚点+空格+日期片段在同一run)
      //    c) <w:t>检测：</w:t><w:t>   </w:t> (锚点和空格在不同run)
      if (role.name && role.name.trim()) {
        for (const anchor of role.anchors) {
          const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          // 策略1: 锚点在 <w:t> 内（可能后面跟空格或其他内容）→ 锚点后直接插入姓名
          const re = new RegExp(`(<w:t\\b[^>]*>)([^<]*${escaped})`);
          if (re.test(newTc)) {
            newTc = newTc.replace(re, (_m: string, p1: string, p2: string) => p1 + p2 + role.name);
            break;
          }
          // 策略2: 锚点跨相邻 <w:t>（如"检测"在一个run，"："在下一个run）
          // 将锚点拆分为标签和冒号两部分，分别匹配两个相邻的 <w:t>
          const parts = anchor.split(/([：:])/);
          if (parts.length === 3) {
            const labelPart = parts[0]; // "检测"
            const colonPart = parts[1]; // "：" 或 ":"
            const escapedLabel = labelPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const escapedColon = colonPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re2 = new RegExp(
              `(<w:t\\b[^>]*>[^<]*${escapedLabel}</w:t>)([\\s\\S]*?<w:t\\b[^>]*>[^<]*)${escapedColon}(<\\/w:t>)`
            );
            if (re2.test(newTc)) {
              newTc = newTc.replace(re2, (_m: string, p1: string, p2: string, p3: string) => p1 + p2 + escapedColon + role.name + p3);
              logger.info(`跨run锚点匹配成功: 锚点"${anchor}"拆分为"${labelPart}"+"${colonPart}"`);
              break;
            }
          }
        }
      }

      // 2. 替换日期：日期被拆分到多个 <w:t>（如 "202" "X" "年" "X" "月" "XX" "日"）
      //    策略：找到日期占位符的 <w:t> 序列，整体替换为单个含实际日期的 <w:t>
      if (role.date && role.date.trim()) {
        const beforeReplace = newTc;
        newTc = this.replaceMultiRunDate(newTc, role.date);
        if (newTc === beforeReplace) {
          logger.warn(`replaceMultiRunDate 未替换: role=${role.anchors[0]}, date=${role.date}, cellWtCount=${(beforeReplace.match(/<w:t\b/g)||[]).length}`);
        } else {
          logger.info(`replaceMultiRunDate 替换成功: role=${role.anchors[0]}, date=${role.date}`);
        }
      } else if (role.name && role.name.trim()) {
        // 姓名已填入但日期为空：保留模板占位符原样
        logger.info(`签名日期跳过（未提供）: role=${role.anchors[0]}, hasName=true`);
      }

      // 替换回 result
      result = result.substring(0, tcMatchRe.index) + newTc + result.substring(tcMatchRe.index + tc.length);
    }

    return result;
  }

  /**
   * 替换被拆分到多个 <w:t> 的日期占位符
   * WPS 常见格式: <w:t>202</w:t><w:t>X</w:t><w:t>年</w:t><w:t>X</w:t><w:t>月</w:t><w:t>XX</w:t><w:t>日</w:t>
   * 也支持: <w:t>202X年6</w:t><w:t>月17日</w:t> (部分合并的片段)
   * 策略：找到连续的日期 <w:t> 序列，替换为单个 <w:t>实际日期</w:t>
   */
  private replaceMultiRunDate(cellXml: string, actualDate: string): string {
    // 收集所有 <w:t> 标签信息（用 s 标志支持跨行内容）
    const wtRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    const wts: Array<{ full: string; text: string; index: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = wtRegex.exec(cellXml)) !== null) {
      wts.push({ full: m[0], text: m[1], index: m.index, end: m.index + m[0].length });
    }

    // 单run日期：锚点文本和日期占位符在同一<w:t>中
    // 如 <w:t>检测：                            202X年X月XX日</w:t>
    if (wts.length === 1) {
      const text = wts[0].text;
      // 直接替换文本中的日期占位符为实际日期
      const patterns = [
        /20\dX年\d{1,2}月\d{1,2}日/g,
        /20\dX年X月XX日/g,
        /20XX年XX月XX日/g,
      ];
      let newText = text;
      let replaced = false;
      for (const pat of patterns) {
        if (pat.test(newText)) {
          newText = newText.replace(pat, actualDate);
          replaced = true;
          break;
        }
      }
      if (replaced) {
        const newWt = wts[0].full.replace(
          /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/,
          (_m2: string, p1: string, _p2: string, p3: string) => p1 + this.escapeXml(newText) + p3
        );
        return cellXml.substring(0, wts[0].index) + newWt + cellXml.substring(wts[0].end);
      }
      return cellXml;
    }

    // 多run日期：找日期序列从含"20"的片段开始到"日"结束
    // 更宽松的起始匹配：文本以 20 开头，且包含日期特征（X占位符或年月日或纯数字）
    for (let i = 0; i < wts.length; i++) {
      const startText = wts[i].text.trim();


      // 起始条件：文本以 20 开头，并且满足以下之一：
      //   1) 含 X 占位符（如 202X, 20X, 20XX）
      //   2) 是纯数字日期开头（如 2025, 202）
      //   3) 文本以 20 开头且后面紧跟 年/数字/X（如 202X年6月...）
      const isDateStart =
        /^2/.test(startText) && (
          /X/.test(startText) ||                                    // 含X占位符
          /^\d+$/.test(startText) ||                                // 纯数字（如 2, 20, 202, 2025）
          /^2[X\d]*[年月]/.test(startText)                          // 2开头跟年或月
        );
      if (!isDateStart) continue;

      // 向后查找 "日"（从 i 开始：单run日期"202X年X月XX日"的"日"在同一元素内）
      for (let j = i; j < wts.length; j++) {
        // 找到含"日"的片段（可能合并如"17日"）
        if (wts[j].text.trim().endsWith("日") || wts[j].text.trim() === "日") {
          // 找到完整日期序列 [i..j]
          // 验证中间是否都是日期片段（年/月/数字/X/空格）
          let isDate = true;
          for (let k = i; k <= j; k++) {
            if (!/^[\s\dX年月日]+$/.test(wts[k].text) && !/^[\s\dX年月日]+$/.test(wts[k].text.trim())) {
              isDate = false;
              break;
            }
          }
          if (isDate) {
            // 整体替换为单个 <w:t>actualDate</w:t>
            const firstTc = wts[i].full;
            const newWt = firstTc.replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/, (_match, p1: string, _p2: string, p3: string) => p1 + this.escapeXml(actualDate) + p3);
            const before = cellXml.substring(0, wts[i].index);
            const after = cellXml.substring(wts[j].end);
            return before + newWt + after;
          }
          break; // 只处理最近的"日"
        }
      }
    }
    return cellXml;
  }

  /** 提取 XML 片段中所有 <w:t> 文本的拼接值（处理多run单元格） */
  private getAllWtText(xml: string): string {
    const texts: string[] = [];
    const regex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(xml)) !== null) {
      const t = m[1].trim();
      // 过滤以 < 开头的文本（XML tag 残留）和空字符串，与 getCellMergedTexts 保持一致
      if (t && !t.startsWith("<")) texts.push(t);
    }
    return texts.join("");
  }

  /**
   * 在锚点段落中追加人名（用于在"检测："等标签后填入签名人名）
   *
   * 核心原则：不修改模板 XML 结构，只替换 <w:t> 文本内容。
   * 策略：找到包含锚点文本（如"检测："）的 <w:t>，将其文本替换为 "锚点+人名"（如"检测：张三"）。
   * 模板段落数量、格式属性完全不变。
   */
  insertTextAfterAnchor(
    targetXml: string,
    anchorText: string,
    sourceText: string
  ): string {
    if (!sourceText || !sourceText.trim()) {
      // 源文档无人名数据 → 跳过，保留模板原样
      return targetXml;
    }

    // 1. 查找包含锚点文本的 <w:t>
    const escaped = anchorText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchorRegex = new RegExp(
      "(<w:t\\b[^>]*>)" + escaped + "(<\\/w:t>)",
      "g"
    );

    const m = anchorRegex.exec(targetXml);
    if (!m) {
      logger.warn(`未找到锚点: "${anchorText}"`);
      return targetXml;
    }

    // 2. 替换该 <w:t> 的文本为 "锚点 + 人名"
    //    例如: <w:t>检测：</w:t> → <w:t>检测：张三</w:t>
    const escapedSource = this.escapeXml(sourceText.trim());
    const newWt = m[1] + anchorText + escapedSource + m[2];

    // 3. 返回修改后的 XML（只替换了这一处 w:t 文本）
    return (
      targetXml.substring(0, m.index) +
      newWt +
      targetXml.substring(m.index + m[0].length)
    );
  }

  /** XML 转义 */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * 填充指定表格的签名行（适用于 KV 表等没有独立列表数据路径的表格）
   * 
   * @param targetXml 整个 document.xml
   * @param tableIndex 表格索引
   * @param sig 签名数据块
   * @returns 修改后的 XML 和是否成功标记
   */
  fillTableSignature(
    targetXml: string,
    tableIndex: number,
    sig: { inspectorName?: string; inspectorDate?: string; checkerName?: string; checkerDate?: string; reviewerName?: string; reviewerDate?: string }
  ): { xml: string; filled: boolean } {
    const tblRegex = /<w:tbl[ >]/g;
    let tblMatch: RegExpExecArray | null;
    let tblIdx = 0;

    while ((tblMatch = tblRegex.exec(targetXml)) !== null) {
      if (tblIdx !== tableIndex) {
        tblIdx++;
        continue;
      }

      const targetTbl = extractTagContent(targetXml, tblMatch.index, "w:tbl");
      if (!targetTbl) break;

      // 提取所有行
      const targetRows = this.extractAllRows(targetTbl);
      if (targetRows.length === 0) break;

      // 检查最后一行是否为签名行
      const lastRowXml = targetRows[targetRows.length - 1].xml;
      const lastRowTexts = this.getAllWtText(lastRowXml);
      const hasSignatureRow = /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(lastRowTexts);
      
      if (!hasSignatureRow) {
        logger.info(`表格[${tableIndex}]: 末行无签名关键词，跳过签名填充`);
        return { xml: targetXml, filled: false };
      }

      // 填充签名行
      let filledSigRow = this.fillSignatureRowDirect(lastRowXml, sig);
      filledSigRow = this.replaceDatePlaceholders(filledSigRow);
      filledSigRow = this.trimSpacesBeforeDate(filledSigRow);

      // 组装回完整表格
      const tblWrapper = this.getTableWrapper(targetTbl);
      const rowsBeforeSig = targetRows.slice(0, -1).map(r => r.xml).join("");
      const rebuiltTbl = tblWrapper.prefix + rowsBeforeSig + filledSigRow + tblWrapper.suffix;

      const newXml = 
        targetXml.substring(0, tblMatch.index) +
        rebuiltTbl +
        targetXml.substring(tblMatch.index + targetTbl.length);

      logger.info(`表格[${tableIndex}]签名行填充成功`);
      return { xml: newXml, filled: true };
    }

    return { xml: targetXml, filled: false };
  }
}

export const xmlSubtreeInserter = new XmlSubtreeInserter();
