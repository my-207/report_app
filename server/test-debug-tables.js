const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

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

// 只看前3个表格
let searchPos = 0, tblIdx = 0;
while (searchPos < xml.length - 6 && tblIdx < 3) {
  const tblStart = xml.indexOf("<w:tbl>", searchPos);
  if (tblStart === -1) break;
  const tbl = extractTagContent(xml, tblStart, "w:tbl");
  if (!tbl) { searchPos = tblStart + 1; continue; }
  tblIdx++;
  
  console.log("\n=== 表格" + tblIdx + " (长度=" + tbl.length + ") ===");
  
  // 提取前3个 <w:tr>
  let trPos = 0, trCount = 0;
  while (trCount < 3) {
    const trStart = tbl.indexOf("<w:tr>", trPos);
    if (trStart === -1) break;
    const tr = extractTagContent(tbl, trStart, "w:tr");
    if (!tr) break;
    trCount++;
    
    // 提取 tr 中的所有 <w:t> 文本
    const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    const texts = [];
    let wm;
    while ((wm = wtRegex.exec(tr)) !== null) {
      const t = wm[1].trim();
      if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
    }
    console.log("  行" + trCount + ": 文本数=" + texts.length + (texts.length > 0 ? " [" + texts.join(", ") + "]" : ""));
    
    // 如果没有 <w:t>，检查是否有其他内容
    if (texts.length === 0) {
      const hasTc = tr.includes("<w:tc>");
      const hasP = tr.includes("<w:p ");
      console.log("    包含 <w:tc>: " + hasTc + ", <w:p>: " + hasP);
      // 显示片段
      if (hasTc) {
        const tcStart = tr.indexOf("<w:tc>");
        console.log("    第一个 tc 片段: " + tr.substring(tcStart, tcStart + 100).replace(/</g, "&lt;"));
      }
    }
    
    trPos = trStart + tr.length;
  }
  
  searchPos = tblStart + tbl.length;
}
