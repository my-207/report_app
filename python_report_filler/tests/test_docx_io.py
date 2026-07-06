"""测试 DOCX IO 模块"""

import tempfile
from pathlib import Path

from report_filler.docx_io import DocxIO


def test_unpack_pack_roundtrip(template_path):
    """测试解包→打包循环：验证 roundtrip 后文件可正常解包"""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        unpacked = tmp / "unpacked"
        output_docx = tmp / "roundtrip.docx"

        # 解包
        word_dir = DocxIO.unpack(str(template_path), str(unpacked))
        assert word_dir.exists()
        assert (word_dir / "document.xml").exists()

        # 读取 XML
        tree = DocxIO.read_document_xml(unpacked)
        assert tree is not None
        assert tree.tag.endswith("document")

        # 写回（不做任何修改）
        DocxIO.write_document_xml(tree, unpacked)

        # 打包
        result = DocxIO.pack(str(unpacked), str(output_docx))
        assert Path(result).exists()
        assert Path(result).stat().st_size > 1000  # 至少 1KB

        # 验证可再次解包
        verify_dir = tmp / "verify"
        word_dir2 = DocxIO.unpack(str(output_docx), str(verify_dir))
        assert (word_dir2 / "document.xml").exists()


def test_read_write_xml(template_path):
    """测试 XML 读写"""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        unpacked = DocxIO.copy_template(str(template_path), tmp)

        # 读取 raw XML
        raw = DocxIO.read_document_xml_raw(unpacked)
        assert len(raw) > 1000
        assert "<w:document" in raw

        # 读取 parsed
        tree = DocxIO.read_document_xml(unpacked)
        assert tree is not None


def test_cleanup(template_path):
    """测试清理"""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        unpacked = DocxIO.copy_template(str(template_path), tmp)
        assert unpacked.exists()

        DocxIO.cleanup(unpacked)
        assert not unpacked.exists()
