import path from "path";
import fs from "fs";
import { statementsParser } from "../services/statements-parser.service";
import { templateService } from "../services/template.service";
import { docxService } from "../services/docx.service";
import { extractTagContent, extractWtTexts, isKeyValueTable } from "../utils/xml-utils";

async function main() {
  const projectRoot = path.join(__dirname, "..", "..", "..");
  const templatePath = path.join(projectRoot, "年度检查报告（模版）.docx");
  const rjPath = path.join(projectRoot, "statements.rj");

  const templateBuffer = fs.readFileSync(templatePath);
  const { sessionId } = await templateService.processUpload(templateBuffer, "年度检查报告（模版）.docx");

  const templateXml = await templateService.getDocumentXml(sessionId);
  const templateTables: string[] = [];
  const tblRegex = /<w:tbl[ >]/g;
  let tm: RegExpExecArray | null;
  while ((tm = tblRegex.exec(templateXml)) !== null) {
    const tbl = extractTagContent(templateXml, tm.index, "w:tbl");
    if (tbl) templateTables.push(tbl);
  }

  const rjContent = fs.readFileSync(rjPath, "utf-8");
  const analysis = statementsParser.parse(rjContent);

  // 对每个源表格，尝试匹配模板表格
  console.log("=== 源表格 → 模板表格匹配 ===\n");
  for (const ch of analysis.chapters) {
    for (let ti = 0; ti < ch.tables.length; ti++) {
      const sourceTbl = ch.tables[ti];
      const sourceHeaders = getFirstRowHeaders(sourceTbl);
      const match = findBestMatch(sourceTbl, templateTables);
      console.log(`章节 ${ch.id} 表格[${ti}] 源表头:[${sourceHeaders.join(", ")}]`);
      if (match) {
        const tmplHeaders = getFirstRowHeaders(templateTables[match.index]);
        console.log(`  → 匹配模板表格[${match.index}] 匹配度:${match.score.toFixed(2)} 模板表头:[${tmplHeaders.join(", ")}] 键值对:${isKeyValueTable(templateTables[match.index])}`);
      } else {
        console.log(`  → 未找到匹配模板表格`);
      }
    }
  }
}

function getFirstRowHeaders(tableXml: string): string[] {
  const firstRowMatch = tableXml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/);
  if (!firstRowMatch) return [];
  return (firstRowMatch[0].match(/<w:t\b[^>]*>(.*?)<\/w:t>/g) || [])
    .map(s => s.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
}

function findBestMatch(sourceTableXml: string, templateTables: string[]): { index: number; score: number } | null {
  const sourceHeaders = getFirstRowHeaders(sourceTableXml);
  if (sourceHeaders.length === 0) return null;

  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < templateTables.length; i++) {
    const tmplHeaders = getFirstRowHeaders(templateTables[i]);
    if (tmplHeaders.length === 0) continue;
    const score = matchHeaders(tmplHeaders, sourceHeaders);
    if (score >= 0.4 && (!best || score > best.score)) {
      best = { index: i, score };
    }
  }
  return best;
}

function matchHeaders(templateHeaders: string[], dataHeaders: string[]): number {
  if (templateHeaders.length === 0 || dataHeaders.length === 0) return 0;
  const templateSet = new Set(templateHeaders.map(h => h.toLowerCase().trim()));
  const dataSet = new Set(dataHeaders.map(h => h.toLowerCase().trim()));
  let matches = 0;
  for (const h of dataSet) {
    for (const th of templateSet) {
      if (th.includes(h) || h.includes(th)) {
        matches++;
        break;
      }
    }
  }
  return matches / Math.max(dataHeaders.length, templateHeaders.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
