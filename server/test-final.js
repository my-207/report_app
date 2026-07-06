const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

// 修复后的 extractTagContent
function extractTagContent(xml, startPos, tagName) {
  const openTag = "<" + tagName + ">";
  const closeTag = "</" + tagName + ">";
  let depth = 1;
  let pos = startPos + openTag.length;
  while (pos < xml.length - closeTag.length) {
    const nextOpen = xml.indexOf(openTag, pos);
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen + openTag.length; }
    else { depth--; if (depth === 0) return xml.substring(startPos, nextClose + closeTag.length); pos = nextClose + closeTag.length; }
  }
  return null;
}

// 提取所有表格
console.log("=== 表格表头提取测试 ===\n");
let searchPos = 0, tblIdx = 0;
while (searchPos < xml.length - 6) {
  const tblStart = xml.indexOf("<w:tbl>", searchPos);
  if (tblStart === -1) break;
  const tbl = extractTagContent(xml, tblStart, "w:tbl");
  if (!tbl) { searchPos = tblStart + 1; continue; }

  // 提取第一个 <w:tr>
  const trStart = tbl.indexOf("<w:tr>");
  if (trStart !== -1) {
    const firstTr = extractTagContent(tbl, trStart, "w:tr");
    if (firstTr) {
      const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
      const texts = [];
      let wm;
      while ((wm = wtRegex.exec(firstTr)) !== null) {
        const t = wm[1].trim();
        if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
      }
      if (texts.length > 0) {
        console.log("表格" + (tblIdx + 1) + ": [" + texts.join(", ") + "]");
      }
    }
  }
  tblIdx++;
  searchPos = tblStart + tbl.length;
}
console.log("\n总表格: " + tblIdx + " 个");
