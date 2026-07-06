import { TemplateStructure, TemplateSection, UnifiedReportData, BasicInfo, SectionData, KeyValuePair, DataTable, SignatureBlock } from "../types";
import { templateService } from "./template.service";
import { extractTagContent, findAllTags, getCellMergedTexts, isKeyValueTable, isNestedKvTable, analyzeRowCells, RowAnalysis, CellInfo } from "../utils/xml-utils";
import { logger } from "../utils/logger";

/**
 * 模板结构分析器 — 从模板 XML 产出 TemplateStructure
 * 输出纯结构描述（不含任何数据值），供填数阶段定位模板槽位
 */
export class TemplateAnalyzer {
  /**
   * 分析模板结构
   * @param sessionId 模板上传后的会话 ID
   * @returns TemplateStructure（占位符字段映射 + 表格列定义 + 键值对标签 + 签名行位置）
   */
  async analyze(sessionId: string): Promise<TemplateStructure> {
    const xml = await templateService.getDocumentXml(sessionId);
    const templateAnalysis = await templateService.analyzeTemplate(sessionId);

    const sections: TemplateSection[] = [];

    // 从占位符分析结果提取字段映射
    const placeholderMap = new Map<string, string[]>();
    for (const p of templateAnalysis.placeholders) {
      if (!placeholderMap.has(p.mapTo)) {
        placeholderMap.set(p.mapTo, []);
      }
      placeholderMap.get(p.mapTo)!.push(p.pattern);
    }

    // 解析模板表格结构
    const tblRegex = /<w:tbl[ >]/g;
    let tblMatch: RegExpExecArray | null;
    let tblIdx = 0;
    let lastNonKvColumns: Array<{ header: string; mappedField: string }> | null = null;
    let lastTableEndIndex = 0; // 上一个表格结束位置，用于扫描中间段落
    const usedTitles = new Set<string>(); // 已分配标题，用于去重避免子标题被编号标题覆盖

    while ((tblMatch = tblRegex.exec(xml)) !== null) {
      const tbl = extractTagContent(xml, tblMatch.index, "w:tbl");
      if (!tbl) { tblIdx++; continue; }

      const isKv = isKeyValueTable(tbl);

      // 提取表头行（智能双层表头检测）
      // 使用 gridSpan 展开版本：如"检查项目及其内容" gridSpan=4 → 展开为4个相同列名
      // 这样列数与数据行的逻辑列数一致，填充时列映射正确
      const firstTrRegex = /<w:tr[ >]/;
      const trMatch = firstTrRegex.exec(tbl);
      let headers: string[] = [];
      if (trMatch) {
        const firstTr = extractTagContent(tbl, trMatch.index, "w:tr");
        if (firstTr) {
          headers = getCellMergedTextsExpanded(firstTr)
            .filter(t => t && t.length < 50);
        }
      }

      // ---- 表格名称提取（优先级: 表格前段落 > 表格内第一格） ----
      let sectionTitle = "";

      // 1. 扫描表格前的段落文本（表格间区域）
      if (tblIdx > 0 || lastTableEndIndex > 0) {
        const beforeXml = xml.substring(lastTableEndIndex, tblMatch.index);
        sectionTitle = extractTableTitleFromParagraphs(beforeXml, usedTitles);
      } else {
        // 第一个表格：扫描文档开头到第一个表格之间的段落
        const beforeXml = xml.substring(0, tblMatch.index);
        sectionTitle = extractTableTitleFromParagraphs(beforeXml, usedTitles);
      }

      // 更新表格结束位置（当前表格开始 + 表格内容长度）
      const tblEndIndex = tblMatch.index + tbl.length;
      lastTableEndIndex = tblEndIndex;

      // 2. 如果段落中没找到标题，回退到表格内第一格提取
      //    也覆盖已有标题：当第一格是数字开头子标题（如"3 防腐（保温）层检查"），
      //    说明当前表格是父章节下的独立子表格，应使用子标题
      if (headers.length > 0 && headers[0].length >= 3) {
        const firstCell = headers[0];
        const isDigitSubTitle = /^\d+[\s\u3000]*[\u4e00-\u9fa5]/.test(firstCell)
          && /(检查|测定|调查|检验|试验|审查|记载)$/.test(firstCell);
        const isTitleLike = /表\s*\d+[-－]\d+/.test(firstCell)
          || /[一二三四五六七八九十]+[、，．]/.test(firstCell)
          || firstCell.length >= 5;
        if (!sectionTitle && isTitleLike && !usedTitles.has(firstCell)) {
          sectionTitle = firstCell;
        } else if (sectionTitle && isDigitSubTitle && !usedTitles.has(firstCell)) {
          // 父章节下的子表格：用子标题覆盖父标题
          sectionTitle = firstCell;
          logger.info(`子表格标题覆盖: table_${tblIdx} "${firstCell}" ← 原标题="${sectionTitle}"`);
        }
      }

      // 双层/三层表头检测：
      // 场景1（双层）：Row0合并标题行（1-2格）→ Row1列名行
      // 场景2（三层）：Row0大标题（1格）→ Row1合并子标题（gridSpan多）→ Row2列名行
      // 判断条件：非KV表 + 第一行单元格≤2 + 存在更多表头行
      if (headers.length <= 2 && !isKv) {
        const allTrMatches = findAllTags(tbl, "w:tr");
        if (allTrMatches.length >= 2) {
          const secondTrXml = allTrMatches[1].content;
          const secondHeaders = getCellMergedTextsExpanded(secondTrXml)
            .filter(t => t && t.length < 50);
          // 第二行有3个以上有效列名，且比第一行多 → 可能是列名行
          if (secondHeaders.length >= 3 && secondHeaders.length > headers.length) {
            // 三层表头检测：Row1 有大量 gridSpan（≥2）→ 合并子标题行
            // 此时应进一步检查 Row2 是否为真正的列名行
            const secondGridSpans = (secondTrXml.match(/w:gridSpan\s+w:val="(\d+)"/g) || [])
              .map(s => parseInt(s.match(/\d+/)![0], 10));
            const secondGridSpanGt1 = secondGridSpans.filter(s => s >= 2).length;
            const secondTcCount = (secondTrXml.match(/<w:tc\b/g) || []).length;
            const isSecondMergeTitle = secondTcCount >= 2 && secondGridSpanGt1 >= Math.ceil(secondTcCount * 0.6);

            if (isSecondMergeTitle && allTrMatches.length >= 3) {
              // Row1 是合并子标题行 → 使用 Row2 作为列名行
              const thirdTrXml = allTrMatches[2].content;
              const thirdHeaders = getCellMergedTextsExpanded(thirdTrXml)
                .filter(t => t && t.length < 50);
              if (thirdHeaders.length >= 3) {
                // Row2 是真正的列名行
                if (!sectionTitle && headers.length > 0 && headers[0].length >= 3) {
                  sectionTitle = headers[0];
                }
                headers = thirdHeaders;
                logger.info(`三层表头检测: table_${tblIdx} Row0格=${headers.length} Row1格=${secondHeaders.length}(gridSpan=${secondGridSpanGt1}) → 列名行=Row2(${thirdHeaders.length}格)`);
              } else {
                // Row2 列数不足，回退使用 Row1
                if (!sectionTitle && headers.length > 0 && headers[0].length >= 3) {
                  sectionTitle = headers[0];
                }
                headers = secondHeaders;
              }
            } else {
              // Row1 不是合并子标题行 → 正常双层表头，使用 Row1 作为列名行
              if (!sectionTitle && headers.length > 0 && headers[0].length >= 3) {
                sectionTitle = headers[0];
              }
              headers = secondHeaders;
            }
          }
        }
      }

      // 将标题编码到 sectionId 中，供 generateSampleData 解码使用
      const encodedSectionId = sectionTitle
        ? `table_${tblIdx}|||${sectionTitle}`
        : `table_${tblIdx}`;
      // 记录已使用的标题，避免后续表格复用此标题
      if (sectionTitle) usedTitles.add(sectionTitle);

      // 混合表检测：逐行分析行类型
      // 混合表特征：前N行为KV键值对 + 可能有列表/文本区 + 末行为签名行
      // 支持三种形态：
      //   (a) KV + 列表 + 签名（如管道参数表+检验记录+签名）
      //   (b) 纯KV + 文本区 + 签名（如原始资料审查报告 Table #3）
      //   (c) 纯KV + 签名（简单键值对表）
      // 使用 analyzeRowCells 逐单元格扫描，正确处理 gridSpan 和 vMerge
      const allTrMatches = findAllTags(tbl, "w:tr");
      let isHybrid = false;
      let hybridKvKeys: string[] = [];
      let hybridColumns: Array<{ header: string; mappedField: string }> = [];
      let hybridListHeaderRows = 0;

      if (allTrMatches.length >= 4) {
        // 逐行分析，找到每行的类型
        const rowAnalyses: RowAnalysis[] = [];
        for (const tr of allTrMatches) {
          rowAnalyses.push(analyzeRowCells(tr.content));
        }

        // 检测 Row0 是否为 KV 行
        const row0RawCells = getCellMergedTexts(allTrMatches[0].content);
        const row0Kv = rowAnalyses[0].isKvRow;
        const kvPairCount = countKvPairsInRowExtended(row0RawCells, rowAnalyses[0].cells);
        const row0IsKvRow = row0Kv || (kvPairCount >= 2 && row0RawCells.length >= 4 && !rowAnalyses[0].isHeaderRow);

        // 统计连续KV行数量（从Row0开始）
        let consecutiveKvRows = 0;
        for (let ri = 0; ri < rowAnalyses.length; ri++) {
          if (rowAnalyses[ri].isKvRow) consecutiveKvRows++;
          else break;
        }

        // 末行是否为签名行
        const lastRowIsSig = rowAnalyses[rowAnalyses.length - 1].isSignatureRow;

        // 混合表判定条件（满足任一）：
        //   1) Row0是KV + 末行是签名行 + 行数>=4（支持1行KV+列表+签名的混合表）
        //   2) Row0是KV + 至少2个连续KV行 + 行数>=4（纯KV+文本区+签名表）
        //   3) Row0是KV + 至少3个连续KV行 + 行数>=4（KV+其他混合）
        const isHybridTable = row0IsKvRow && allTrMatches.length >= 4 &&
          (lastRowIsSig || consecutiveKvRows >= 2);

        if (isHybridTable) {
          isHybrid = true;
          logger.info(`混合表检测: table_${tblIdx} Row0物理=${row0RawCells.length}格 逻辑=${rowAnalyses[0].logicalColCount}列 KV对=${kvPairCount} 连续KV行=${consecutiveKvRows} 末行签名=${lastRowIsSig}`);

          // 提取 KV 标签：遍历所有KV行，使用 analyzeRowCells 的 cells 跟踪 vMerge
          // 对于 vMerge restart 行，正确提取标签（如"管道级别"）
          // 对于 vMerge continue 行，跳过（它是上一行合并的延续）
          const kvLabelsSet = new Set<string>();
          
          // 第一遍：扫描所有合并标题行（gridSpan≥4的大合并格），作为子标题
          // 这些子标题（如"原始资料审查及问题记载"、"历次定期检验问题记载"）在表格中部
          for (let ri = 0; ri < rowAnalyses.length; ri++) {
            const rowA = rowAnalyses[ri];
            if (rowA.isMergeTitleRow) {
              for (const cell of rowA.cells) {
                const t = cell.text.trim();
                if (t && t.length >= 4 && t.length < 50
                    && !/^[X\d\s]+$/.test(t)
                    && !/检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(t)) {
                  kvLabelsSet.add(t);
                }
              }
            }
          }
          
          // 第二遍：扫描连续KV行的标签
          for (let ri = 0; ri < rowAnalyses.length; ri++) {
            const rowA = rowAnalyses[ri];
            if (rowA.isMergeTitleRow) continue; // 合并标题行已在第一遍处理
            if (rowA.isSignatureRow) break; // 遇到签名行停止
            
            // vMerge continue 行（如 Row 13 "绝热层厚度"）：
            // isKvRow=false 但仍含有效标签，不能 break，跳过 continue 单元格继续扫描
            const hasVMergeContinue = rowA.cells.some(c => c.vMerge === 'continue');
            if (!rowA.isKvRow && !hasVMergeContinue) break; // 真正的非KV行才停止

            const cells = rowA.cells;
            // 按物理单元格配对扫描：cells[0]=标签1, cells[1]=值1, cells[2]=标签2, cells[3]=值2...
            for (let ci = 0; ci < cells.length - 1; ci += 2) {
              const cell = cells[ci];
              // 跳过 vMerge continue 单元格（它是上一行合并的延续）
              if (cell.vMerge === 'continue') continue;

              const label = cell.text;
              // 标签有效性过滤（与 analyzeRowCells isKvRow 一致）
              const listKw = new Set(["序号", "编号", "检验项目", "检查项目", "检查内容", "检查结果", "备注", "日期", "处理措施"]);
              if (label && label.length > 0 && label.length < 50
                  && !/^\d+$/.test(label)
                  && !/^[\/\-—－_]+$/.test(label.trim())
                  && !listKw.has(label)) {
                kvLabelsSet.add(label);
              }
            }
          }
          hybridKvKeys = [...kvLabelsSet];

          // 找列表头行：第一个非KV、非合并标题、非签名、非vMerge延续的行
          // 对于纯KV+文本区+签名的表（如Table #3），没有列表头
          let listHeaderStart = -1;
          for (let ri = 0; ri < rowAnalyses.length; ri++) {
            const ra = rowAnalyses[ri];
            if (!ra.isKvRow && !ra.isMergeTitleRow && !ra.isSignatureRow) {
              // 跳过含 vMerge continue 的行（如Table #3 R13，是上一行KV的垂直合并延续）
              const hasVMergeContinue = ra.cells.some(c => c.vMerge === 'continue');
              if (hasVMergeContinue) continue;
              listHeaderStart = ri;
              break;
            }
          }

          // 列表头可能有多行（双层表头）
          hybridListHeaderRows = 0;
          if (listHeaderStart >= 0 && listHeaderStart < rowAnalyses.length) {
            hybridListHeaderRows = 1;
            // 如果下一行也是表头模式，扩展到2行
            if (listHeaderStart + 1 < rowAnalyses.length) {
              const nextRow = rowAnalyses[listHeaderStart + 1];
              if (nextRow.isHeaderRow || (nextRow.cells.some(c => c.vMerge !== 'none'))) {
                hybridListHeaderRows = 2;
                logger.info(`混合表双层列表头: table_${tblIdx}`);
              }
            }

            // 列表列名提取（展开gridSpan，使列名数=逻辑列数，与fillRowWithData对齐）
            if (hybridListHeaderRows === 2 && listHeaderStart + 1 < allTrMatches.length) {
              // 双层表头：合并两行，vMerge=continue列用Row1文本，其余用Row2文本
              const row1Expanded = getCellMergedTextsExpanded(allTrMatches[listHeaderStart].content);
              const row2Expanded = getCellMergedTextsExpanded(allTrMatches[listHeaderStart + 1].content);
              // 构建 Row2 的展开vMerge状态数组（与展开文本一一对应）
              const row2Analysis = rowAnalyses[listHeaderStart + 1];
              const row2VmExpanded: string[] = [];
              for (const cell of row2Analysis.cells) {
                for (let s = 0; s < cell.gridSpan; s++) {
                  row2VmExpanded.push(cell.vMerge);
                }
              }
              // 合并：vMerge=continue → 用Row1文本；否则 → 用Row2文本；都空 → 用Row1文本
              const mergedHeaders: string[] = [];
              const maxLen = Math.max(row1Expanded.length, row2Expanded.length);
              for (let li = 0; li < maxLen; li++) {
                const r2Text = row2Expanded[li] || '';
                const r1Text = row1Expanded[li] || '';
                const isContinue = row2VmExpanded[li] === 'continue';
                const header = isContinue ? r1Text : (r2Text || r1Text);
                mergedHeaders.push(header);
              }
              // 过滤过长的列名（>50字符），空列名替换为 列N 避免Record键冲突
              const filtered = mergedHeaders.filter(t => t && t.length < 50);
              // 对空列名赋默认值
              hybridColumns = filtered.map((h, idx) => {
                const header = h || `列${idx + 1}`;
                return { header, mappedField: header };
              });
              logger.info(`混合表双层表头合并: table_${tblIdx}, Row1=${row1Expanded.length}列, Row2=${row2Expanded.length}列, 合并=${hybridColumns.length}列`);
            } else {
              // 单行表头：用展开版（gridSpan展开），使列名数=逻辑列数
              const listHeaderCells = getCellMergedTextsExpanded(allTrMatches[listHeaderStart].content)
                .filter(t => t && t.length < 50);
              hybridColumns = listHeaderCells.map((h, idx) => {
                const header = h || `列${idx + 1}`;
                return { header, mappedField: header };
              });
            }
          }

          // 如果没有列表头（纯KV+文本区+签名表），hybridColumns 为空
          // 这种表的文本区行（如"原始资料审查及问题记载"）由 filler 按KV标签匹配填充
          if (hybridColumns.length === 0) {
            logger.info(`混合表无列表头（纯KV+文本区+签名）: table_${tblIdx}, kvKeys=${hybridKvKeys.length}`);
          }
        }
      }

      // 根据表格类型构建不同的结构描述
      if (isHybrid) {
        // 混合表：输出 KV + 列表两部分结构
        const sigLabels = allTrMatches.length > 0
          ? getCellMergedTexts(allTrMatches[allTrMatches.length - 1].content)
              .filter(t => t && t.length < 80)
          : [];
        sections.push({
          sectionId: encodedSectionId,
          placeholderFields: [],
          tables: [{
            tableIndex: tblIdx,
            isKeyValue: false,
            isHybrid: true,
            hybridListHeaderRows,
            kvKeys: hybridKvKeys,
            columns: hybridColumns,
          }],
          signaturePosition: { tableIndex: tblIdx },
          signatureFields: sigLabels.length > 0 ? sigLabels : undefined,
        });
      } else if (isKv) {
        // 键值对表：遍历所有行，从每行的标签位提取键名
        // 智能 kvStartIdx：奇数格+首格vMerge=类别列（如"性能参数"，5格）→ kvStartIdx=1
        //                  偶数格=标准KV（4格/2格）→ kvStartIdx=0
        // 原方案的缺陷：对所有 vMerge 首格统一跳过，导致 restart 行的有效标签（如"管道级别"）丢失
        const kvKeys: string[] = [];
        for (const tr of allTrMatches) {
          const rowCells = getCellMergedTexts(tr.content);
          let kvStartIdx = 0;
          // 仅当奇数格（有独立的类别列占位）+ 首格 vMerge 时才跳过第一列
          // 偶数格时 vMerge restart（如"管道级别"）是有效 KV 标签，不应跳过
          if (rowCells.length % 2 === 1 && rowCells.length > 0) {
            const firstTcRegex = /<w:tc[ >]/;
            const firstTcMatch = firstTcRegex.exec(tr.content);
            if (firstTcMatch) {
              const firstTc = extractTagContent(tr.content, firstTcMatch.index, "w:tc");
              if (firstTc && /<w:vMerge\b/.test(firstTc)) {
                kvStartIdx = 1;
              }
            }
          }
          // 遍历该行所有列（偶数位=标签，奇数位=值），从 kvStartIdx 开始
          for (let i = kvStartIdx; i < rowCells.length - 1; i += 2) {
            const label = rowCells[i];
            // 过滤空标签、纯数字、过长文本
            if (label && label.length > 0 && label.length < 50 && !/^\d+$/.test(label)) {
              kvKeys.push(label);
            }
          }
        }
        // 去重：同一键名可能出现在多行（如"检验日期"同时出现在数据行和签名行）
        let uniqueKeys = [...new Set(kvKeys)];

        // 签名行检测：KV表的最后一行可能是签名行（如"检查：202X年6月17日"）
        // 检测到签名行时：排除签名行文本从kvKeys，并设置signaturePosition
        let kvSignaturePosition: { tableIndex: number } | null = null;
        if (allTrMatches.length > 0) {
          const lastRowTexts = getCellMergedTexts(allTrMatches[allTrMatches.length - 1].content);
          const isSignatureRow = lastRowTexts.some(t =>
            /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(t)
          );
          if (isSignatureRow) {
            kvSignaturePosition = { tableIndex: tblIdx };
            // 从kvKeys中排除签名行文本（如"检查：202X年6月17日"）
            uniqueKeys = uniqueKeys.filter(k =>
              !/检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(k)
            );
            logger.info(`KV表签名行检测: table_${tblIdx} 最后一行为签名行，已排除签名行kvKeys`);
          }
        }

        sections.push({
          sectionId: encodedSectionId,
          placeholderFields: [],
          tables: [{ tableIndex: tblIdx, isKeyValue: true, kvKeys: uniqueKeys, columns: [] }],
          signaturePosition: kvSignaturePosition,
        });
      } else {
        // 检查是否为嵌套KV表（行数据含大量 vMerge/gridSpan）
        const isNestedKv = isNestedKvTable(tbl);

        if (isNestedKv) {
          const nestedKvKeys = extractNestedKvKeys(allTrMatches);
          
          // 额外提取合并标题行（gridSpan≥4的大合并格）作为子标题
          // 嵌套KV表可能包含子章节标题（如"6 壁厚测定"、"7 地质条件调查"）
          for (const tr of allTrMatches) {
            const rowA = analyzeRowCells(tr.content);
            if (rowA.isMergeTitleRow) {
              for (const cell of rowA.cells) {
                const t = cell.text.trim();
                if (t && t.length >= 4 && t.length < 50
                    && !/^[X\d\s]+$/.test(t)
                    && !/检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(t)
                    && !nestedKvKeys.includes(t)) {
                  nestedKvKeys.push(t);
                }
              }
            }
          }

          logger.info(`嵌套KV表检测: table_${tblIdx} keys=${nestedKvKeys.length} rows=${allTrMatches.length}`);

          // 回退检查：如果提取的 keys 全是短数字或签名文本，说明不是真正的嵌套KV表
          // 而是列表型表被误判，回退为列表型表处理
          const meaningfulKeys = nestedKvKeys.filter(k =>
            k && !/^\d+$/.test(k) && !/检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(k)
          );
          if (meaningfulKeys.length === 0) {
            // 没有有意义的 key → 回退为列表型表
            logger.info(`嵌套KV表回退为列表型表: table_${tblIdx} (keys全是数字或签名)`);
            // 跳过嵌套KV处理，进入列表型表分支
            let columns = headers.map(h => ({ header: h, mappedField: h }));
            const lastTrRegex = /<w:tr[ >]/g;
            let lastTrMatch: RegExpExecArray | null;
            let lastTrXml: string | null = null;
            while ((lastTrMatch = lastTrRegex.exec(tbl)) !== null) {
              lastTrXml = extractTagContent(tbl, lastTrMatch.index, "w:tr");
            }
            const sigLabels = lastTrXml
              ? getCellMergedTexts(lastTrXml).filter(t => t && t.length < 80)
              : [];
            const lastRowHasSignature = sigLabels.some(t =>
              /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(t)
            );
            const subTitles: string[] = [];
            for (const tr of allTrMatches) {
              const rowA = analyzeRowCells(tr.content);
              if (rowA.isMergeTitleRow) {
                for (const cell of rowA.cells) {
                  const t = cell.text.trim();
                  if (t && t.length >= 4 && t.length < 50
                      && !/^[X\d\s]+$/.test(t)
                      && !/检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(t)
                      && !usedTitles.has(t)) {
                    subTitles.push(t);
                    usedTitles.add(t);
                  }
                }
              }
            }
            sections.push({
              sectionId: encodedSectionId,
              placeholderFields: [],
              tables: [{ tableIndex: tblIdx, isKeyValue: false, columns, kvKeys: subTitles }],
              signaturePosition: lastRowHasSignature ? { tableIndex: tblIdx } : null,
              signatureFields: lastRowHasSignature && sigLabels.length > 0 ? sigLabels : undefined,
            });
          } else {
            sections.push({
            sectionId: encodedSectionId,
            placeholderFields: [],
            tables: [{
              tableIndex: tblIdx,
              isKeyValue: false,
              isNestedKv: true,
              kvKeys: nestedKvKeys,
              columns: [],
            }],
            signaturePosition: null,
          });
          }
        } else {
        // 列表型表
        let columns = headers.map(h => ({ header: h, mappedField: h }));

        // 跨页拆分表格检测：当前表格的 headers 若像数据值（含数字、单位、短数据），
        // 且列数与前一非KV表相近，则判定为 continuation，复用前一表的 columns。
        let isContinuation = false;
        if (lastNonKvColumns && lastNonKvColumns.length > 0 && headers.length >= 2) {
          // 统计像"数据值"的单元格比例（含数字、单位、状态词）
          const dataLikeCount = headers.filter(h =>
            /\d/.test(h) ||
            /mm|MPa|℃|合格|符合|允许|不得|≥|≤/.test(h) ||
            /^[0-9.]{1,6}$/.test(h)
          ).length;
          const halfOrMoreDataLike = dataLikeCount >= headers.length / 2;
          const similarColCount = Math.abs(headers.length - lastNonKvColumns.length) <= 2;

          if (halfOrMoreDataLike && similarColCount) {
            columns = lastNonKvColumns.map(c => ({ header: c.header, mappedField: c.mappedField }));
            isContinuation = true;
            logger.info(
              `跨页拆分表检测: table_${tblIdx} 判为 continuation, 复用前表 ${lastNonKvColumns.length} 列`
            );
          }
        }

        if (!isContinuation) {
          lastNonKvColumns = columns;
        }

        // 提取最后一行文本作为签名字段标签
        const lastTrRegex = /<w:tr[ >]/g;
        let lastTrMatch: RegExpExecArray | null;
        let lastTrXml: string | null = null;
        while ((lastTrMatch = lastTrRegex.exec(tbl)) !== null) {
          lastTrXml = extractTagContent(tbl, lastTrMatch.index, "w:tr");
        }
        const sigLabels = lastTrXml
          ? getCellMergedTexts(lastTrXml).filter(t => t && t.length < 80)
          : [];

        // 签名行验证：只有最后一行含签名关键词（检测：/校对：/审核：/检查：/审批：）时
        // 才设置 signaturePosition。否则最后一行是数据行（如附页表的"8安全保护装置检验"）
        const lastRowHasSignature = sigLabels.some(t =>
          /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(t)
        );

        // 提取表格内的合并标题行（gridSpan≥4的大合并格）作为子标题
        // 这些子标题（如"6 壁厚测定"、"7 地质条件调查"）在目录表/大表格内部
        // 将其作为额外的 kvKeys 记录，使前端能展示这些子章节
        const subTitles: string[] = [];
        for (const tr of allTrMatches) {
          const rowA = analyzeRowCells(tr.content);
          if (rowA.isMergeTitleRow) {
            for (const cell of rowA.cells) {
              const t = cell.text.trim();
              // 过滤：长度≥4、非纯占位符、非签名行文本
              if (t && t.length >= 4 && t.length < 50
                  && !/^[X\d\s]+$/.test(t)
                  && !/检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(t)
                  && !usedTitles.has(t)) {
                subTitles.push(t);
                usedTitles.add(t);
              }
            }
          }
        }

        sections.push({
          sectionId: encodedSectionId,
          placeholderFields: [],
          tables: [{ tableIndex: tblIdx, isKeyValue: false, columns, kvKeys: subTitles }],
          // 只有含签名关键词的最后一行才设为签名行
          signaturePosition: lastRowHasSignature ? { tableIndex: tblIdx } : null,
          signatureFields: lastRowHasSignature && sigLabels.length > 0 ? sigLabels : undefined,
        });
        } // closes if (isNestedKv) else
      }

      tblIdx++;
    }

    // 占位符字段独立为一个模板级章节
    const placeholderFields = Array.from(placeholderMap.entries()).map(([mapTo, patterns]) => ({
      mapTo,
      pattern: patterns.join("|"),
    }));

    if (placeholderFields.length > 0) {
      sections.unshift({
        sectionId: "_placeholders",
        placeholderFields,
        tables: [],
        signaturePosition: null,
      });
    }

    logger.info(`模板结构分析完成: ${sections.length} 个模板段, ${placeholderFields.length} 个占位符字段`);

    return { sections };
  }

  /**
   * 基于模板结构生成模拟样例数据
   * @param structure 模板结构分析结果
   * @returns 带样例值的 UnifiedReportData
   */
  generateSampleData(structure: TemplateStructure): UnifiedReportData {
    const placeholderSection = structure.sections.find(s => s.sectionId === "_placeholders");
    const fieldNames = new Set(
      (placeholderSection?.placeholderFields || []).map(f => f.mapTo)
    );

    // 样例 BasicInfo
    // 注意: mapTo 来自 findPlaceholders(), 由 template.service.ts 定义,
    // 前缀为 "basicInfo." 或独立名称 (inspectionDateRange, signatureDate)
    const basicInfo: BasicInfo = {
      reportNumber: fieldNames.has("basicInfo.reportNumber") ? "GGA-2025-03001-2025" : "",
      companyName: fieldNames.has("basicInfo.companyName") ? "华东特种设备检测有限公司" : "",
      deviceName: fieldNames.has("basicInfo.deviceName") ? "工业管道GC2-DN200-01段" : "",
      reportTypePrefix: fieldNames.has("basicInfo.reportTypePrefix") ? "GGA" : "",
      inspectionStartDate: fieldNames.has("inspectionDateRange") ? "2025年6月" : "",
      inspectionEndDate: fieldNames.has("inspectionDateRange") ? "2025年7月" : "",
      inspectorDate: fieldNames.has("signatureDate") ? "2025年7月15日" : "",
      checkerDate: fieldNames.has("signatureDate") ? "2025年7月15日" : "",
      reviewerDate: fieldNames.has("signatureDate") ? "2025年7月18日" : "",
    };

    // 样例 sections
    const dataSections = structure.sections
      .filter(s => s.sectionId !== "_placeholders");

    const sections: SectionData[] = [];
    for (let i = 0; i < dataSections.length; i++) {
      const sec = dataSections[i];
      // 从模板结构提取表格索引
      const tableIndex = sec.tables[0]?.tableIndex;
      // 解析 sectionId: "table_N|||表格名称" 或 "table_N"
      const sectionParts = sec.sectionId.includes("|||")
        ? sec.sectionId.split("|||", 2)
        : [sec.sectionId, ""];
      const [, encodedTitle] = sectionParts;
      const secData: SectionData = {
        id: `sec_${i + 1}`,
        title: encodedTitle || `表格_${i + 1}`,
        kvPairs: [],
        tables: [],
        signature: {} as SignatureBlock,
        tableIndex,
      };

      for (const tbl of sec.tables) {
        if (tbl.isHybrid) {
          // 混合表：同时产出 kvPairs（从 kvKeys）和 tables（从 columns）
          const keys = tbl.kvKeys || [];
          for (const key of keys) {
            secData.kvPairs.push({ key, value: sampleKvValue(key) });
          }
          const headers = (tbl.columns || []).map(c => c.header);
          // 只有有列表头时才添加表格数据（纯KV+文本区+签名的混合表没有列表头）
          // 避免空表格导致 fillTableFromSource 跳过签名行填充
          if (headers.length > 0) {
            const rows = generateSampleRows(headers, 2);
            secData.tables.push({
              tableType: `entity_${i}`,
              headers,
              rows,
            });
          }
          secData.hasHybridTable = true;
          secData.hybridListHeaderRows = tbl.hybridListHeaderRows ?? 1;
        } else if (tbl.isNestedKv) {
          // 嵌套KV表 → 生成样例 kvPairs
          const keys = tbl.kvKeys || [];
          for (const key of keys) {
            secData.kvPairs.push({ key, value: sampleKvValue(key) });
          }
          secData.hasNestedKvTable = true;
        } else if (tbl.isKeyValue) {
          // 键值对表 → 生成样例 kvPairs
          const keys = tbl.kvKeys || [];
          for (const key of keys) {
            secData.kvPairs.push({ key, value: sampleKvValue(key) });
          }
        } else {
          // 列表型表 → 生成样例 rows（header→value 映射格式）
          const headers = (tbl.columns || []).map(c => c.header);
          const rows = generateSampleRows(headers, 2);
          secData.tables.push({
            tableType: `entity_${i}`,
            headers,
            rows,
          });
        }
      }

      // 签名行样例数据
      if (sec.signaturePosition) {
        secData.signature = {
          inspectorName: "张工",
          inspectorDate: "2025年7月15日",
          checkerName: "李工",
          checkerDate: "2025年7月16日",
          reviewerName: "王主任",
          reviewerDate: "2025年7月18日",
        };
      }

      sections.push(secData);
    }

    // 兜底：诊断并处理空数据 section
    const coveredIndices = new Set(sections.map(s => s.tableIndex).filter((t): t is number => t !== undefined));
    for (const sec of dataSections) {
      const ti = sec.tables[0]?.tableIndex;
      if (ti === undefined || coveredIndices.has(ti)) continue;

      const sectionParts = sec.sectionId.includes("|||")
        ? sec.sectionId.split("|||", 2)
        : [sec.sectionId, ""];
      const [, encodedTitle] = sectionParts;

      // 尽量从模板结构中提取可用信息
      const tb = sec.tables[0];
      const kvKeys = tb?.kvKeys || [];
      const columns = tb?.columns || [];
      const fallbackData: SectionData = {
        id: `sec_fallback_${ti}`,
        title: encodedTitle || `表格_${ti + 1}`,
        kvPairs: kvKeys.length > 0 ? kvKeys.map(k => ({ key: k, value: sampleKvValue(k) })) : [],
        tables: columns.length > 0
          ? [{ tableType: `entity_fallback_${ti}`, headers: columns.map(c => c.header), rows: generateSampleRows(columns.map(c => c.header), 2) }]
          : [],
        signature: {} as SignatureBlock,
        tableIndex: ti,
        hasHybridTable: tb?.isHybrid || false,
        hybridListHeaderRows: tb?.hybridListHeaderRows ?? 1,
      };
      sections.push(fallbackData);
      logger.warn(`⚠️  兜底覆盖未生成数据的表格 [${ti}]${encodedTitle}`);
    }

    const emptyDataSections = sections.filter(s => s.kvPairs.length === 0 && s.tables.length === 0);
    if (emptyDataSections.length > 0) {
      logger.warn(`⚠️  ${emptyDataSections.length} 个 section 数据为空（填充将被跳过）: ${emptyDataSections.map(s => `[${s.tableIndex}]${s.title}`).join(", ")}`);
    }

    logger.info(`样例数据生成完成: basicInfo字段=${Object.values(basicInfo).filter(Boolean).length}, sections=${sections.length}`);
    return { basicInfo, sections };
  }
}
export const templateAnalyzer = new TemplateAnalyzer();

// ==================== 嵌套KV表键提取 ====================

/**
 * 从嵌套KV表中提取所有Key标签（含vMerge层级结构的表格）
 *
 * 同步自 Python _extract_nested_kv_keys，策略：
 *   1. 跳过 Row0 (表头行)
 *   2. 检测并跳过"类别标题行"（≤4格 + 第二格gridSpan≥4 + 无vMerge）
 *   3. 从有效数据行提取每行最后一个有意义文本作为 KEY
 *   4. 排除 vMerge=continue、纯数字(序号)、已见过的key
 */
function extractNestedKvKeys(allTrMatches: Array<{ index: number; content: string }>): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (let r = 1; r < allTrMatches.length; r++) {
    const rowXml = allTrMatches[r].content;
    const rowAnalysis = analyzeRowCells(rowXml);
    const cells = rowAnalysis.cells;

    // === 检测类别标题行 (Section Header Rows) ===
    // 特征: ≤4格, C1的gridSpan>=4, 无vMerge单元格
    // 这些是大类标题如 "3 防腐层检查"、"6 壁厚测定" 等
    if (cells.length <= 4) {
      const c1GridSpan = cells.length > 1 ? cells[1].gridSpan : 1;
      const hasVMerge = cells.some(c => c.vMerge !== 'none');
      if (c1GridSpan >= 4 && !hasVMerge) {
        continue; // 跳过类别标题行
      }
    }

    // === 从数据行提取KEY ===
    // 策略: 找到最后一个有实际文本的非空、非序号、非vM=continue 的单元格
    let candidateKey: string | null = null;

    for (const cell of cells) {
      if (cell.vMerge === 'continue') continue;
      const text = cell.text.trim();
      if (!text) continue;
      if (/^\d+$/.test(text)) continue; // 跳过序号列

      // 记录最后一个有意义的文本作为候选 key
      candidateKey = text;
    }

    if (candidateKey && !seen.has(candidateKey)) {
      keys.push(candidateKey);
      seen.add(candidateKey);
    }
  }

  return keys;
}




// ==================== 样例生成辅助函数 ====================

/** 根据 KV 标签语义生成样例值 */
function sampleKvValue(key: string): string {
  const k = key.replace(/[：:]/g, "").trim();
  const map: Record<string, string> = {
    "设备名称": "工业管道GC2-DN200-01段",
    "管道名称": "工业管道GC2-DN200-01段",
    "设备型号": "DN200-PN1.6",
    "管道规格": "DN200-PN1.6",
    "公称直径": "200mm",
    "公称通径": "DN200",
    "外径": "219mm",
    "壁厚": "8.0mm",
    "设计压力": "1.6MPa",
    "工作压力": "1.2MPa",
    "设计温度": "200℃",
    "工作温度": "150℃",
    "介质": "压缩空气",
    "工作介质": "压缩空气",
    "管道材质": "20#钢",
    "材质": "20#钢",
    "管道长度": "约350m",
    "使用登记证编号": "管GC-2023-0089",
    "检验类别": "年度检查",
    "检查依据": "TSG D7005-2018",
    "检验日期": "2025年6月",
    "检查日期": "2025年6月",
    "检测日期": "2025年6月",
    "报告编号": "GGA-2025-03001-2025",
    "使用单位": "华东化工有限公司",
    "安装单位": "华东安装工程有限公司",
    "检验机构": "华东特种设备检测有限公司",
    "安全状况等级": "2级",
    "检验结论": "符合要求，允许继续使用",
    "备注": "—",
  };

  // 精确匹配
  if (map[k]) return map[k];
  // 模糊匹配
  for (const [pattern, val] of Object.entries(map)) {
    if (k.includes(pattern) || pattern.includes(k)) return val;
  }

  // 默认根据 key 类型猜测
  if (/直径|径/.test(k)) return "200mm";
  if (/厚/.test(k)) return "8.0mm";
  if (/压力/.test(k)) return "1.6MPa";
  if (/温/.test(k)) return "200℃";
  if (/材质|材料/.test(k)) return "20#钢";
  if (/长度|距离/.test(k)) return "约350m";
  if (/日期|时间/.test(k)) return "2025年6月";
  if (/单位|公司/.test(k)) return "华东化工有限公司";
  if (/编号/.test(k)) return "GC-2025-0001";
  if (/规格|型号/.test(k)) return "DN200-PN1.6";

  return `${k}-样例值`;
}

/** 统计一行中有多少对有效 KV（偶数位短标签即可，值是否为空不影响计数）
 *  模板中 KV 值单元格通常为空（待填），所以不要求 value 非空。
 *  阈值从 <15 放宽到 <50 以匹配 Hybrid 检测中的标签长度过滤。 */
function countKvPairsInRow(cells: string[]): number {
  let count = 0;
  for (let i = 0; i < cells.length - 1; i += 2) {
    const label = cells[i];
    if (label && label.length > 0 && label.length < 50 && !/^\d+$/.test(label)) {
      count++; // 不检查 value 是否非空（模板值本就是空的）
    }
  }
  return count;
}

/** 
 * 扩展版 KV 对计数：使用 CellInfo 数组，正确处理 vMerge continue 和 gridSpan
 * 返回有效 KV 标签数量
 */
function countKvPairsInRowExtended(cells: string[], cellInfos?: CellInfo[]): number {
  let count = 0;
  if (cellInfos && cellInfos.length > 0) {
    // 使用 CellInfo 追踪逻辑列位置（处理 vMerge continue 和 gridSpan）
    let logicalCol = 0;
    for (const ci of cellInfos) {
      if (ci.vMerge === 'continue') continue; // 跳过合并延续格
      if (logicalCol % 2 === 0 && ci.text && ci.text.length > 0 && ci.text.length < 50 && !/^\d+$/.test(ci.text)) {
        count++;
      }
      logicalCol += ci.gridSpan;
    }
  } else {
    // 降级：使用原始 cells 数组
    for (let i = 0; i < cells.length - 1; i += 2) {
      const label = cells[i];
      if (label && label.length > 0 && label.length < 50 && !/^\d+$/.test(label)) {
        count++;
      }
    }
  }
  return count;
}

/** 从 XML 段落区域提取表格标题（匹配"（N-N）..."或"表N-N..."等模式）
 *  @param usedTitles 已使用的标题集合（可选），用于去重：跳过已分配给前置表格的标题 */
function extractTableTitleFromParagraphs(beforeXml: string, usedTitles?: Set<string>): string {
  if (!beforeXml || beforeXml.trim().length === 0) return "";

  // 提取所有段落文本
  const pRegex = /<w:p[ >]/g;
  const texts: string[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = pRegex.exec(beforeXml)) !== null) {
    const pContent = extractTagContent(beforeXml, pm.index, "w:p");
    if (!pContent) continue;
    // 提取段落中所有文本
    const tRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let tm: RegExpExecArray | null;
    const words: string[] = [];
    while ((tm = tRegex.exec(pContent)) !== null) {
      if (tm[1] && !tm[1].startsWith("<")) words.push(tm[1]);
    }
    const text = words.join("").trim();
    if (text) texts.push(text);
  }

  if (texts.length === 0) return "";

  // 第一遍: 优先查找含"附页""附图"关键词的标题（如"XXXXXX年度检查报告附页"）
  // 这类标题是文档附录主标题，应优先于子标题（如"（7-1）地址条件调查报告"）
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i];
    if (/附页|附图/.test(text) && text.length >= 5) {
      return text;
    }
  }

  // 第二遍: 从最后一个段落开始往回找（标题通常在表格紧上方）
  // 如果 usedTitles 提供，跳过已分配给他表格的标题，让后续块拾取未占用的子标题
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i];
    // 匹配中文括号章节编号: （3-1）... 或 （三）...
    if (/^[（(][\d一二三四五六七八九十]+[)\）\-—][^）)]/.test(text) && text.length >= 5) {
      if (!usedTitles || !usedTitles.has(text)) return text;
    }
    // 匹配 "表 N-N" 模式
    if (/^表\s*\d+[-－]\d+/.test(text) && text.length >= 3) {
      if (!usedTitles || !usedTitles.has(text)) return text;
    }
    // 匹配纯中文章节标题（无编号但含"报告""检测""记录"等关键词）
    if (/[报告检测记录检查审查测定]$/.test(text) && text.length >= 6 && !/^[X\d\s]+$/.test(text)) {
      if (!usedTitles || !usedTitles.has(text)) return text;
    }
    // 匹配以数字开头的标题（如"6 壁厚测定"、"7  地质条件调查"、"8  安全保护装置检验"）
    if (/^\d+[\s\u3000]+\S/.test(text) && text.length >= 4 && !/^[X\d\s]+$/.test(text)) {
      if (!usedTitles || !usedTitles.has(text)) return text;
    }
    // 匹配以"记载""调查""检验"等结尾的纯中文子标题
    //   （如"原始资料审查及问题记载"、"历次定期检验问题记载"）
    if (/(记载|调查|检验)$/.test(text) && text.length >= 5 && !/^[X\d\s]+$/.test(text)) {
      if (!usedTitles || !usedTitles.has(text)) return text;
    }
  }

  return "";
}

/**
 * 提取行的单元格文本列表（展开 gridSpan 版本）
 * 与 getCellMergedTexts 不同，本方法将 gridSpan 单元格的文本重复展开为多个逻辑列
 * 例如: ["序号", "检查项目及其内容"(gridSpan=4), "检查结果", "备注"]
 *   → ["序号", "检查项目及其内容", "检查项目及其内容", "检查项目及其内容", "检查项目及其内容", "检查结果", "备注"]
 * 这样列数与数据行的逻辑列数一致，填充时列映射正确
 */
function getCellMergedTextsExpanded(rowXml: string): string[] {
  const cells: string[] = [];
  const tcRegex = /<w:tc[ >]/g;
  let tcMatch: RegExpExecArray | null;
  while ((tcMatch = tcRegex.exec(rowXml)) !== null) {
    const tc = extractTagContent(rowXml, tcMatch.index, "w:tc");
    if (tc) {
      // 提取单元格文本
      const wtRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
      let wtMatch: RegExpExecArray | null;
      const parts: string[] = [];
      while ((wtMatch = wtRegex.exec(tc)) !== null) {
        const t = wtMatch[1].trim();
        if (t && !t.startsWith("<")) parts.push(t);
      }
      const text = parts.join("");
      // 读取 gridSpan
      const gsMatch = /<w:gridSpan\s+w:val="(\d+)"/.exec(tc);
      const span = gsMatch ? parseInt(gsMatch[1], 10) : 1;
      // 展开为 span 个逻辑列
      for (let s = 0; s < span; s++) {
        cells.push(text);
      }
    }
  }
  return cells;
}

/** 根据列名生成样本行数据 */
function generateSampleRows(headers: string[], count: number): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (let r = 0; r < count; r++) {
    const row: Record<string, string> = {};
    for (const h of headers) {
      row[h] = sampleCellValue(h, r);
    }
    rows.push(row);
  }
  return rows;
}

/** 根据列名语义生成单元格样例值 */
function sampleCellValue(header: string, rowIndex: number): string {
  const h = header.replace(/[：:]/g, "").trim();
  const seq = rowIndex + 1;

  if (/序号|编号/.test(h)) return String(seq);
  if (/日期/.test(h)) return `2025-0${6 + rowIndex}-${String(10 + seq).padStart(2, "0")}`;
  if (/检测|检查/.test(h)) return ["壁厚测定", "焊缝无损检测", "安全附件检查"][rowIndex % 3];
  if (/结果/.test(h)) return ["合格", "符合要求"][rowIndex % 2];
  if (/结论|判定/.test(h)) return "符合要求";
  if (/备注/.test(h)) return "—";
  if (/规格|型号/.test(h)) return `DN${200 + seq * 50}-PN1.6`;
  if (/数值|实测|测量|厚度/.test(h)) return `${7.5 + rowIndex * 0.3}mm`;
  if (/点|位置|部位/.test(h)) return `测点${seq}`;
  if (/等级/.test(h)) return ["1级", "2级", "3级"][rowIndex % 3];

  return `${h}-样例${seq}`;
}
