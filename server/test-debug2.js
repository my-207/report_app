const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

function extractTagContent(xml, startPos, tagName) {
  const openTag = "<" + tagName + ">";
  const closeTag = "</" + tagName + ">";
  let depth = 1;
  let pos = startPos + openTag.length;
  let iterations = 0;
  while (pos < xml.length - closeTag.length && iterations < 10000) {
    iterations++;
    const nextOpen = xml.indexOf(openTag, pos);
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen + openTag.length; }
    else { depth--; if (depth === 0) return xml.substring(startPos, nextClose + closeTag.length); pos = nextClose + closeTag.length; }
  }
  return null;
}

// 只看第一个表格
const tblStart = xml.indexOf("<w:tbl>");
console.log("第一个 <w:tbl> 在: " + tblStart);

const tbl = extractTagContent(xml, tblStart, "w:tbl");
console.log("表格长度: " + (tbl ? tbl.length : "null"));

if (tbl) {
  // 检查是否有 <w:tr>
  const trCount = (tbl.match(/<w:tr>/g) || []).length;
  console.log("包含 <w:tr>: " + trCount + " 个");
  
  // 提取第一个 <w:tr>
  const trStart = tbl.indexOf("<w:tr>");
  console.log("第一个 <w:tr> 在表格内位置: " + trStart);
  
  if (trStart !== -1) {
    // 不用 extractTagContent，直接用正则看第一个 tr
    const trChunk = tbl.substring(trStart, trStart + 5000);
    console.log("第一个 tr 片段长度: " + trChunk.length);
    
    // 看有多少 <w:t>
    const wtMatches = trChunk.match(/<w:t[ >]/g);
    console.log("前5000字符中 <w:t 数量: " + (wtMatches ? wtMatches.length : 0));
    
    // 提取文本
    const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let wm, count = 0;
    while ((wm = wtRegex.exec(trChunk)) !== null) {
      const t = wm[1].trim();
      if (t && !t.startsWith("<") && t.length < 30) {
        count++;
        if (count <= 10) console.log("  文本: [" + t + "]");
      }
    }
    console.log("前5000字符中有效文本数: " + count);
    
    // 现在用 extractTagContent 试试
    const tr = extractTagContent(tbl, trStart, "w:tr");
    console.log("extractTagContent w:tr 结果: " + (tr ? tr.length + " 字符" : "null"));
  }
}
