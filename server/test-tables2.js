const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

// 检查 w:tbl 的实际出现
const tblCount = (xml.match(/<w:tbl[ >]/g) || []).length;
const tblEndCount = (xml.match(/<\/w:tbl>/g) || []).length;
console.log("<w:tbl 标签: " + tblCount + " 个");
console.log("</w:tbl> 标签: " + tblEndCount + " 个");

// 找第一个 <w:tbl
let firstIdx = xml.search(/<w:tbl[ >]/);
if (firstIdx !== -1) {
  // 显示前后上下文
  console.log("\n第一个表格位置: " + firstIdx);
  console.log("上下文: ..." + xml.substring(firstIdx, firstIdx + 80) + "...");
  
  // 找对应的 </w:tbl>
  let depth = 0;
  for (let i = firstIdx; i < xml.length - 7; i++) {
    if (xml.substring(i, i + 5) === "<w:tbl" && (xml[i + 5] === ">" || xml[i + 5] === " ")) depth++;
    else if (xml.substring(i, i + 7) === "</w:tbl>") {
      depth--;
      if (depth === 0) {
        const tbl = xml.substring(firstIdx, i + 7);
        console.log("表格长度: " + tbl.length);
        
        // 提取所有 <w:tr
        const trCount = (tbl.match(/<w:tr[ >]/g) || []).length;
        console.log("行数 (<w:tr): " + trCount);
        
        // 提取第一个 tr 的文本
        let trStart = tbl.search(/<w:tr[ >]/);
        if (trStart !== -1) {
          let trDepth = 0;
          for (let j = trStart; j < tbl.length - 6; j++) {
            if (tbl.substring(j, j + 4) === "<w:tr" && (tbl[j + 4] === ">" || tbl[j + 4] === " ")) trDepth++;
            else if (tbl.substring(j, j + 6) === "</w:tr") {
              trDepth--;
              if (trDepth === 0) {
                const tr = tbl.substring(trStart, j + 6);
                const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
                const texts = [];
                let wm;
                while ((wm = wtRegex.exec(tr)) !== null) {
                  const t = wm[1].trim();
                  if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
                }
                console.log("表头: [" + texts.join(", ") + "]");
                break;
              }
            }
          }
        }
        break;
      }
    }
  }
}
