const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

// 检查 XML 中有多少 w:tr
const tr1 = (xml.match(/<w:tr>/g) || []).length;
const tr2 = (xml.match(/<w:tr /g) || []).length;
const tr3 = (xml.match(/<\/w:tr>/g) || []).length;
console.log("<w:tr>: " + tr1 + " 个");
console.log("<w:tr : " + tr2 + " 个");
console.log("</w:tr>: " + tr3 + " 个");

// 找一个实际的 tr 看看
const firstTrPos = xml.search(/<w:tr[ >]/);
if (firstTrPos !== -1) {
  console.log("\n第一个 <w:tr> 在位置: " + firstTrPos);
  console.log("上下文: " + xml.substring(firstTrPos, firstTrPos + 60));
}

// 检查表格和 tr 的命名空间关系
// 可能 w:tr 在文档中是嵌套在 w:tbl 中的，但可能有 xml:space 等属性
const tblStart = xml.indexOf("<w:tbl>");
if (tblStart !== -1) {
  const tblEnd = xml.indexOf("</w:tbl>", tblStart);
  console.log("\n第一个表格范围: " + tblStart + " - " + (tblEnd + 7));
  
  // 在这个范围内搜索 tr
  const tblRange = xml.substring(tblStart, tblEnd + 7);
  console.log("此范围内 <w:tr 出现次数: " + (tblRange.match(/<w:tr[ >]/g) || []).length);
  
  // 检查是否有其他命名空间的 tr
  console.log("此范围内 <m:tr 出现次数: " + (tblRange.match(/<m:tr/g) || []).length);
  console.log("此范围内 <v:tr 出现次数: " + (tblRange.match(/<v:tr/g) || []).length);
  
  // 列出范围内所有标签
  const tags = tblRange.match(/<\/?[a-zA-Z]+:[a-zA-Z]+/g) || [];
  const uniqueTags = [...new Set(tags)];
  console.log("\n范围内所有标签: " + uniqueTags.join(", "));
}
