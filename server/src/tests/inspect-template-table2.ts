import path from "path";
import fs from "fs";
import { docxService } from "../services/docx.service";
import { extractTagContent, getRowCells } from "../utils/xml-utils";

async function main() {
  const templatePath = path.join(__dirname, "..", "..", "..", "年度检查报告（模版）.docx");
  const unpackDir = path.join(__dirname, "..", "..", "..", "output", "_inspect_template2");
  await docxService.unpack(templatePath, unpackDir);

  const docXml = fs.readFileSync(path.join(unpackDir, "word", "document.xml"), "utf-8");
  const tables: string[] = [];
  const tblRegex = /<w:tbl[ >]/g;
  let tm: RegExpExecArray | null;
  while ((tm = tblRegex.exec(docXml)) !== null) {
    const tbl = extractTagContent(docXml, tm.index, "w:tbl");
    if (tbl) tables.push(tbl);
  }

  // 表格[2] 原始资料审查报告
  const tbl = tables[2];
  const rows: string[][] = [];
  const trRegex = /<w:tr[ >]/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(tbl)) !== null) {
    const tr = extractTagContent(tbl, trMatch.index, "w:tr");
    if (tr) rows.push(getRowCells(tr));
  }

  console.log(`表格[2] 共 ${rows.length} 行，前10行内容：`);
  rows.slice(0, 10).forEach((r, i) => {
    console.log(`行${i}: [${r.join(" | ")}]`);
  });

  // 保存完整 XML 以便查看
  const outPath = path.join(__dirname, "..", "..", "..", "output", "table2.xml");
  fs.writeFileSync(outPath, tbl, "utf-8");
  console.log("\n表格[2] XML 已保存:", outPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
