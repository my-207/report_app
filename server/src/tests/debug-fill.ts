import path from "path";
import fs from "fs";
import { statementsParser } from "../services/statements-parser.service";
import { fillerService } from "../services/filler.service";
import { docxService } from "../services/docx.service";
import { templateService } from "../services/template.service";
import { isKeyValueTable, extractTagContent } from "../utils/xml-utils";
import { logger } from "../utils/logger";

async function main() {
  const projectRoot = path.join(__dirname, "..", "..", "..");
  const templatePath = path.join(projectRoot, "年度检查报告（模版）.docx");
  const rjPath = path.join(projectRoot, "statements.rj");
  const outputPath = path.join(projectRoot, "output", "debug-报告.docx");

  if (!fs.existsSync(templatePath)) {
    console.error("模板不存在:", templatePath);
    return;
  }
  if (!fs.existsSync(rjPath)) {
    console.error(".rj 不存在:", rjPath);
    return;
  }

  // 1. 上传/解压模板
  const templateBuffer = fs.readFileSync(templatePath);
  const { sessionId: templateSessionId } = await templateService.processUpload(templateBuffer, "年度检查报告（模版）.docx");
  console.log("模板 sessionId:", templateSessionId);

  // 2. 模板分析
  const templateAnalysis = await templateService.analyzeTemplate(templateSessionId);
  console.log("\n=== 模板表格分析 ===");
  console.log("表格数量:", templateAnalysis.tables.length);
  console.log("占位符:", templateAnalysis.placeholders.slice(0, 10));

  const templateXml = await templateService.getDocumentXml(templateSessionId);
  const templateTables: string[] = [];
  const tblRegex = /<w:tbl[ >]/g;
  let tm: RegExpExecArray | null;
  while ((tm = tblRegex.exec(templateXml)) !== null) {
    const tbl = extractTagContent(templateXml, tm.index, "w:tbl");
    if (tbl) templateTables.push(tbl);
  }
  templateTables.forEach((tbl, i) => {
    const firstRowMatch = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/);
    const firstRowTexts = firstRowMatch
      ? (firstRowMatch[0].match(/<w:t\b[^>]*>(.*?)<\/w:t>/g) || []).map(s => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean)
      : [];
    const allRows = tbl.match(/<w:tr[ >]/g)?.length || 0;
    console.log(`\n模板表格[${i}] 行数:${allRows} 表头:[${firstRowTexts.join(", ")}] 是否键值对:${isKeyValueTable(tbl)}`);
  });

  // 3. 解析 .rj
  const rjContent = fs.readFileSync(rjPath, "utf-8");
  const analysis = statementsParser.parse(rjContent);

  console.log("\n=== .rj 章节表格分析 ===");
  console.log("章节数:", analysis.totalChapters, "表格数:", analysis.totalTables);
  const rjTableSummary: string[] = [];
  analysis.chapters.forEach((ch) => {
    ch.tables.forEach((tbl, ti) => {
      const firstRowMatch = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/);
      const firstRowTexts = firstRowMatch
        ? (firstRowMatch[0].match(/<w:t\b[^>]*>(.*?)<\/w:t>/g) || []).map(s => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean)
        : [];
      const allRows = tbl.match(/<w:tr[ >]/g)?.length || 0;
      const line = `章节 ${ch.id} 表格[${ti}] 行数:${allRows} 表头:[${firstRowTexts.join(", ")}] 是否键值对:${isKeyValueTable(tbl)}`;
      console.log(line);
      rjTableSummary.push(line);
    });
  });

  // 4. 执行填充
  const templateEntry = templateService.getSession(templateSessionId);
  const unpackDir = templateEntry?.unpackDir || "";
  const { fillResult, subtreeStats } = await fillerService.fillBySubtreeCopy(templateSessionId, unpackDir, analysis);

  console.log("\n=== 填充结果 ===");
  console.log("fillResult:", JSON.stringify(fillResult, null, 2));
  console.log("subtreeStats:", JSON.stringify(subtreeStats, null, 2));

  // 5. 打包输出
  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }
  await docxService.pack(unpackDir, outputPath);
  console.log("\n输出文件:", outputPath);

  // 6. 保存完整调试日志
  const logPath = path.join(projectRoot, "output", "debug-fill.log");
  fs.writeFileSync(logPath, JSON.stringify({
    templateTables: templateTables.map((tbl, i) => {
      const firstRowMatch = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/);
      const firstRowTexts = firstRowMatch
        ? (firstRowMatch[0].match(/<w:t\b[^>]*>(.*?)<\/w:t>/g) || []).map(s => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean)
        : [];
      return {
        index: i,
        rowCount: tbl.match(/<w:tr[ >]/g)?.length || 0,
        headers: firstRowTexts,
        isKeyValue: isKeyValueTable(tbl),
        first200Chars: tbl.slice(0, 200),
      };
    }),
    rjTables: rjTableSummary,
    rjTablePreviews: analysis.tablePreviews,
    fillResult,
    subtreeStats,
  }, null, 2), "utf-8");
  console.log("\n调试日志已保存:", logPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
