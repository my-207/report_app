import path from "path";
import fs from "fs";
import { docxService } from "../services/docx.service";
import { extractTagContent, getRowCells } from "../utils/xml-utils";

async function main() {
  const mdPath = path.join(__dirname, "..", "..", "..", "原始MD.docx");
  const unpackDir = path.join(__dirname, "..", "..", "..", "output", "_inspect_md");
  await docxService.unpack(mdPath, unpackDir);

  const docXml = fs.readFileSync(path.join(unpackDir, "word", "document.xml"), "utf-8");

  // 提取所有表格并查找包含"管道名称"的表格
  const tblRegex = /<w:tbl[ >]/g;
  let tm: RegExpExecArray | null;
  let idx = 0;
  while ((tm = tblRegex.exec(docXml)) !== null) {
    const tbl = extractTagContent(docXml, tm.index, "w:tbl");
    if (!tbl) continue;
    if (tbl.includes("管道名称") || tbl.includes("管理单位") || tbl.includes("设备名称") || tbl.includes("管道规格")) {
      const rows: string[][] = [];
      const trRegex = /<w:tr[ >]/g;
      let trMatch: RegExpExecArray | null;
      while ((trMatch = trRegex.exec(tbl)) !== null) {
        const tr = extractTagContent(tbl, trMatch.index, "w:tr");
        if (tr) rows.push(getRowCells(tr));
      }
      console.log(`\n=== 模板表格[${idx}] 包含目标关键词 ===`);
      rows.slice(0, 10).forEach((r, i) => console.log(`行${i}: [${r.join(" | ")}]`));
    }
    idx++;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
