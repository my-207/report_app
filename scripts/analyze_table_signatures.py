# -*- coding: utf-8 -*-
"""
深入分析：检查表格3-28中每个表格底部的签名行，
看看日期占位符是否被拆分到了多个 w:r 中。
同时列出每个表格中是否有 X 占位符。
"""
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

TEMPLATE_PATH = "../年度检查报告（模版）.docx"
NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

def extract_cell_text(cell_elem):
    """提取一个单元格中所有文本（拼接多个 w:r/w:t）"""
    texts = []
    for t in cell_elem.iter(f"{{{NS}}}t"):
        if t.text:
            texts.append(t.text)
    return "".join(texts)

def has_x_placeholder(text):
    return bool(re.search(r'X{3,}|20\dX', text))

def main():
    with zipfile.ZipFile(TEMPLATE_PATH, "r") as zf:
        tree = ET.parse(zf.open("word/document.xml"))
    root = tree.getroot()
    
    body = root.find(f"{{{NS}}}body")
    
    table_idx = 0
    total_date_placeholders = 0
    total_x_in_table = 0
    
    for elem in body.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        
        if tag == "tbl":
            table_idx += 1
            
            # 获取此表格内所有行
            rows = list(elem.iter(f"{{{NS}}}tr"))
            
            # 检查最后几行（签名行通常在最后2-3行）
            last_rows = rows[-3:] if len(rows) >= 3 else rows
            
            table_has_x = False
            table_signatures = []
            
            for row in last_rows:
                cells = list(row.iter(f"{{{NS}}}tc"))
                for cell in cells:
                    cell_text = extract_cell_text(cell)
                    if has_x_placeholder(cell_text):
                        table_has_x = True
                        table_signatures.append(cell_text.strip())
            
            if table_has_x:
                total_x_in_table += len(table_signatures)
                print(f"\n表格{table_idx} (共{len(rows)}行):")
                for sig in table_signatures:
                    # 清理多余空格，便于阅读
                    clean = re.sub(r'\s{2,}', ' ', sig)
                    print(f"  {clean}")
                    if re.search(r'20\dX', sig):
                        total_date_placeholders += 1
    
    print(f"\n{'='*70}")
    print(f"汇总: 表格中共有 {total_date_placeholders} 处日期占位符")
    print(f"      表格中共有 {total_x_in_table} 处X占位符文本片段")

if __name__ == "__main__":
    main()
