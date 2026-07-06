const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

function extractTagContent(xml, startPos, tagName) {
  const openTag = "<" + tagName + ">";
  const closeTag = "</" + tagName + ">";
  let depth = 1;
  let pos = startPos + openTag.length;
  let it = 0;
  while (pos < xml.length - closeTag.length && it < 20000) {
    it++;
    const nextOpen = xml.indexOf(openTag, pos);
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen + openTag.length; }
    else { depth--; if (depth === 0) return xml.substring(startPos, nextClose + closeTag.length); pos = nextClose + closeTag.length; }
  }
  return null;
}

let searchPos = 0, tblIdx = 0, dataTables = 0;
while (searchPos < xml.length - 6) {
  const tblStart = xml.indexOf("<w:tbl>", searchPos);
  if (tblStart === -1) break;
  const tbl = extractTagContent(xml, tblStart, "w:tbl");
  if (!tbl) { searchPos = tblStart + 1; continue; }
  tblIdx++;
  
  const hasTr = tbl.includes("<w:tr>");
  
  if (hasTr) {
    dataTables++;
    // 提取第一个 tr 的表头
    const trStart = tbl.indexOf("<w:tr>");
    const firstTr = extractTagContent(tbl, trStart, "w:tr");
    if (firstTr) {
      const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
      const texts = [];
      let wm;
      while ((wm = wtRegex.exec(firstTr)) !== null) {
        const t = wm[1].trim();
        if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
      }
      console.log("表格" + tblIdx + " (有数据): 表头=[" + texts.join(", ") + "]");
    }
  }
  
  searchPos = tblStart + tbl.length;
}
console.log("\n总 <w:tbl>: " + tblIdx + " 个");
console.log("含 <w:tr> 的数据表: " + dataTables + " 个");
