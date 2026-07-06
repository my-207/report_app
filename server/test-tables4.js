const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

// 找第一个 <w:tbl>
let pos = xml.indexOf("<w:tbl>");
console.log("第一个 <w:tbl> 在: " + pos);

// 用简单计数器跟踪
let depth = 0;
let startPos = pos;
let found = false;

for (let i = startPos; i < xml.length - 7; i++) {
  const s6 = xml.substring(i, i + 6);
  const s7 = xml.substring(i, i + 7);
  
  if (s6 === "<w:tbl>" && xml.substring(i + 6, i + 7) !== "P") {
    depth++;
  } else if (s7 === "</w:tbl>") {
    depth--;
    if (depth === 0) {
      console.log("找到 </w:tbl> 在位置: " + i + " 深度归零");
      const tbl = xml.substring(startPos, i + 7);
      console.log("表格长度: " + tbl.length);
      
      // 提取行
      const trMatches = tbl.match(/<w:tr>/g);
      console.log("行数: " + (trMatches ? trMatches.length : 0));
      
      // 第一个 tr
      let trStart = tbl.indexOf("<w:tr>");
      if (trStart !== -1) {
        let td = 0;
        for (let j = trStart; j < tbl.length - 6; j++) {
          if (tbl.substring(j, j + 5) === "<w:tr>") td++;
          else if (tbl.substring(j, j + 6) === "</w:tr") {
            td--;
            if (td === 0) {
              const tr = tbl.substring(trStart, j + 6);
              const texts = [];
              const wtR = /<w:t[^>]*>(.*?)<\/w:t>/g;
              let wm;
              while ((wm = wtR.exec(tr)) !== null) {
                const t = wm[1].trim();
                if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
              }
              console.log("表头: [" + texts.join(", ") + "]");
              break;
            }
          }
        }
      }
      found = true;
      break;
    }
  }
}

console.log("found: " + found);
