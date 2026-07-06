"""
DOCX 文件 IO 操作：解包/打包/XML 读写

纯标准库实现（zipfile + pathlib），无外部依赖。
替代 TypeScript 版 DocxService（使用 AdmZip 库）。
"""

from __future__ import annotations

import shutil
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

# WordML 命名空间
WORDML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NSMAP = {"w": WORDML_NS}

# document.xml 的相对路径
DOCUMENT_XML_PATH = "word/document.xml"


class DocxIO:
    """DOCX 解包/打包 + XML 读写工具 — 对应 TS docx.service.ts"""

    # ---------- 解包 / 打包 ----------

    @staticmethod
    def unpack(docx_path: str | Path, output_dir: str | Path) -> Path:
        """解压 .docx 文件到指定目录（docx 本质是 zip）

        Args:
            docx_path: .docx 模板路径
            output_dir: 解压目标目录

        Returns:
            xml_dir: document.xml 所在目录（{output_dir}/word/）
        """
        docx_path = Path(docx_path)
        output_dir = Path(output_dir)

        output_dir.mkdir(parents=True, exist_ok=True)

        if not docx_path.exists():
            raise FileNotFoundError(f"模板文件不存在: {docx_path}")

        with zipfile.ZipFile(docx_path, "r") as zf:
            zf.extractall(output_dir)

        word_dir = output_dir / "word"
        if not word_dir.exists():
            raise ValueError(f"解压后未找到 word/ 目录，文件可能不是有效的 .docx: {docx_path}")

        return word_dir

    @staticmethod
    def pack(input_dir: str | Path, output_path: str | Path) -> Path:
        """将解压后的 XML 目录重新打包为 .docx

        Args:
            input_dir: 解压后的目录（包含 word/、_rels/ 等）
            output_path: 输出 .docx 路径

        Returns:
            输出文件的 Path
        """
        input_dir = Path(input_dir)
        output_path = Path(output_path)

        output_path.parent.mkdir(parents=True, exist_ok=True)

        if not input_dir.exists():
            raise FileNotFoundError(f"源目录不存在: {input_dir}")

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_path in sorted(input_dir.rglob("*")):
                if file_path.is_file():
                    arcname = file_path.relative_to(input_dir).as_posix()
                    zf.write(file_path, arcname)

        return output_path

    # ---------- XML 读写 ----------

    @staticmethod
    def read_document_xml(unpack_dir: str | Path) -> etree._Element:
        """读取 document.xml 并解析为 lxml ElementTree

        Args:
            unpack_dir: 解压目录（document.xml 在 {unpack_dir}/word/document.xml）

        Returns:
            lxml Element（根节点 <w:document>）
        """
        unpack_dir = Path(unpack_dir)
        xml_path = unpack_dir / DOCUMENT_XML_PATH

        if not xml_path.exists():
            raise FileNotFoundError(f"document.xml 不存在: {xml_path}")

        # resolve_entities=False 防止 XXE 攻击
        parser = etree.XMLParser(resolve_entities=False)
        tree = etree.parse(str(xml_path), parser)
        return tree.getroot()

    @staticmethod
    def read_document_xml_raw(unpack_dir: str | Path) -> str:
        """读取 document.xml 原始字符串（供校验用）"""
        unpack_dir = Path(unpack_dir)
        xml_path = unpack_dir / DOCUMENT_XML_PATH
        return xml_path.read_text(encoding="utf-8")

    @staticmethod
    def write_document_xml(tree: etree._Element, unpack_dir: str | Path) -> None:
        """将 lxml ElementTree 序列化回 document.xml

        Args:
            tree: document.xml 的 root 节点
            unpack_dir: 解压目录（输出到 {unpack_dir}/word/document.xml）
        """
        unpack_dir = Path(unpack_dir)
        xml_path = unpack_dir / DOCUMENT_XML_PATH

        # 确保 XML 声明 + 正确编码
        xml_bytes = etree.tostring(
            tree,
            xml_declaration=True,
            encoding="UTF-8",
            standalone=True,
        )
        xml_path.write_bytes(xml_bytes)

    @staticmethod
    def copy_template(template_path: str | Path, work_dir: str | Path) -> Path:
        """复制模板到工作目录（不解压，直接解压到临时子目录）

        Args:
            template_path: 源 .docx 文件路径
            work_dir: 工作目录（将创建 {work_dir}/unpacked/）

        Returns:
            unpacked_dir: 解压后的目录
        """
        template_path = Path(template_path)
        work_dir = Path(work_dir)
        unpacked_dir = work_dir / "unpacked"

        # 清理旧数据
        if unpacked_dir.exists():
            shutil.rmtree(unpacked_dir)

        DocxIO.unpack(template_path, unpacked_dir)
        return unpacked_dir

    @staticmethod
    def cleanup(unpack_dir: str | Path) -> None:
        """清理解压目录"""
        unpack_dir = Path(unpack_dir)
        if unpack_dir.exists():
            shutil.rmtree(unpack_dir)

    # ---------- 便捷方法 ----------

    @staticmethod
    def fill_and_pack(
        template_path: str | Path,
        output_path: str | Path,
        fill_func,
        *args,
        **kwargs,
    ) -> Path:
        """一站式操作：解包 → 填充 → 打包 → 清理

        Args:
            template_path: 模板 .docx 路径
            output_path: 输出 .docx 路径
            fill_func: 填充函数，签名为 (tree: etree._Element, unpacked_dir: Path, *args, **kwargs) -> etree._Element
            *args, **kwargs: 传递给 fill_func 的额外参数

        Returns:
            输出 .docx 路径
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            unpacked = DocxIO.copy_template(template_path, tmp)

            tree = DocxIO.read_document_xml(unpacked)

            # 执行填充
            filled_tree = fill_func(tree, unpacked, *args, **kwargs)

            DocxIO.write_document_xml(filled_tree, unpacked)

            return DocxIO.pack(unpacked, output_path)
