import path from "path";
import fs from "fs";
import { docxService } from "../services/docx.service";
import { extractTagContent, extractWtTexts, getRowCells } from "../utils/xml-utils";

async function main() {
  const outputPath = path.join(__dirname, "..", "..", "..", "output", "debug-报告.docx");
  const templatePath = path.join(__dirname, "..", "..", "..", "年度检查报告（模版）.docx");

  if (!fs.existsSync(outputPath)) {
    console.error("输出文件不存在:", outputPath);
    return;
  }

  const unpackDir = path.join(__dirname, "..", "..", "..", "output", "_inspect_output");
  await docxService.unpack(outputPath, unpackDir);

  const docXml = fs.readFileSync(path.join(unpackDir, "word", "document.xml"), "utf-8");

  // 提取所有表格
  const tables: string[] = [];
  const tblRegex = /<w:tbl[ >]/g;
  let tm: RegExpExecArray | null;
  while ((tm = tblRegex.exec(docXml)) !== null) {
    const tbl = extractTagContent(docXml, tm.index, "w:tbl");
    if (tbl) tables.push(tbl);
  }

  console.log(`输出文档共 ${tables.length} 个表格\n`);

  // 对比原模板表格，检查前几个表格是否被填充
  const templateUnpackDir = path.join(__dirname, "..", "..", "..", "output", "_inspect_template");
  await docxService.unpack(templatePath, templateUnpackDir);
  const templateDocXml = fs.readFileSync(path.join(templateUnpackDir, "word", "document.xml"), "utf-8");
  const templateTables: string[] = [];
  tblRegex.lastIndex = 0;
  while ((tm = tblRegex.exec(templateDocXml)) !== null) {
    const tbl = extractTagContent(templateDocXml, tm.index, "w:tbl");
    if (tbl) templateTables.push(tbl);
  }

  // 逐个表格对比前3行文本
  const maxTables = Math.min(tables.length, templateTables.length);
  for (let i = 0; i < maxTables; i++) {
    const outRows = extractRows(tables[i]);
    const tmplRows = extractRows(templateTables[i]);
    console.log(`\n=== 表格[${i}] ===`);
    console.log(`模板前3行:`);
    tmplRows.slice(0, 3).forEach((r, ri) => console.log(`  行${ri}: [${r.join(" | ")}]`));
    console.log(`输出前3行:`);
    outRows.slice(0, 3).forEach((r, ri) => console.log(`  行${ri}: [${r.join(" | ")}]`));
    if (i >= 5) break; // 只看前6个表格
  }

  // 检查签名日期和占位符残留
  const allTexts = extractWtTexts(docXml);
  const remainingPlaceholders = allTexts.filter(t => /X{3,}/.test(t) || /20\dX年/.test(t));
  console.log("\n=== 残留占位符/日期（前30个）===");
  remainingPlaceholders.slice(0, 30).forEach(t => console.log(`  ${t}`));
}

function extractRows(tblXml: string): string[][] {
  const rows: string[][] = [];
  const trRegex = /<w:tr[ >]/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(tblXml)) !== null) {
    const tr = extractTagContent(tblXml, trMatch.index, "w:tr");
    if (tr) {
      rows.push(getRowCells(tr));
    }
  }
  return rows;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
