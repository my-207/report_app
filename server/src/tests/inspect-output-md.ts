import path from "path";
import fs from "fs";
import { docxService } from "../services/docx.service";
import { extractTagContent, getRowCells, extractWtTexts } from "../utils/xml-utils";

async function main() {
  const outputPath = path.join(__dirname, "..", "..", "..", "output", "debug-md-报告.docx");
  const unpackDir = path.join(__dirname, "..", "..", "..", "output", "_inspect_output_md");
  await docxService.unpack(outputPath, unpackDir);

  const docXml = fs.readFileSync(path.join(unpackDir, "word", "document.xml"), "utf-8");

  // 检查残留占位符
  const allTexts = extractWtTexts(docXml);
  const remainingPlaceholders = allTexts.filter(t => /X{3,}/.test(t) || /20\dX年/.test(t));
  console.log("=== 残留占位符/日期（前50个）===");
  remainingPlaceholders.slice(0, 50).forEach(t => console.log(`  ${t}`));

  // 检查签名相关文本
  const sigTexts = allTexts.filter(t => /检测[：:]|校对[：:]|审核[：:]/.test(t));
  console.log("\n=== 签名相关文本（前30个）===");
  sigTexts.slice(0, 30).forEach(t => console.log(`  ${t}`));

  // 检查键值对表格[3]
  const tables: string[] = [];
  const tblRegex = /<w:tbl[ >]/g;
  let tm: RegExpExecArray | null;
  while ((tm = tblRegex.exec(docXml)) !== null) {
    const tbl = extractTagContent(docXml, tm.index, "w:tbl");
    if (tbl) tables.push(tbl);
  }

  console.log("\n=== 表格[3]（管道参数键值对）===");
  const rows = extractRows(tables[3]);
  rows.forEach((r, i) => console.log(`行${i}: [${r.join(" | ")}]`));
}

function extractRows(tblXml: string): string[][] {
  const rows: string[][] = [];
  const trRegex = /<w:tr[ >]/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(tblXml)) !== null) {
    const tr = extractTagContent(tblXml, trMatch.index, "w:tr");
    if (tr) rows.push(getRowCells(tr));
  }
  return rows;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
