const fs = require('fs');
const xml = fs.readFileSync('c:/Users/Administrator/CodeBuddy/报告生成/_analysis/chunk_3_1.xml', 'utf8');

// 找到所有 <w:tr 开头的行
const trRegex = /<w:tr\b/g;
let m;
const trPositions = [];
while ((m = trRegex.exec(xml)) !== null) {
  trPositions.push(m.index);
}

console.log('表格行数:', trPositions.length);

for (let i = 0; i < Math.min(8, trPositions.length); i++) {
  const start = trPositions[i];
  const end = (i + 1 < trPositions.length) ? trPositions[i + 1] : xml.length;
  const tr = xml.substring(start, end);
  
  // 提取文本
  const wtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const texts = [];
  let wm;
  while ((wm = wtRegex.exec(tr)) !== null) {
    if (wm[1]) texts.push(wm[1]);
  }
  
  // 提取 gridSpan
  const gsRegex = /gridSpan w:val="(\d+)"/g;
  const gsValues = [];
  let gm;
  while ((gm = gsRegex.exec(tr)) !== null) {
    gsValues.push(gm[1]);
  }
  
  const tcCount = (tr.match(/<w:tc\b/g) || []).length;
  
  console.log(`Row ${i} | 单元格:${tcCount} | gridSpan:[${gsValues.join(',')}] | 文本: "${texts.join('" | "')}"`);
}
