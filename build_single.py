#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把源码版阅读器打包为单文件 HTML。

用法：
    python build_single.py

输入：
    index.html
    assets/styles.css
    assets/app.js
    vendor/marked.min.js
    vendor/marked.LICENSE

输出：
    Markdown阅读器.html

产物不依赖任何外部文件，可直接复制到任意目录双击打开。
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "Markdown阅读器.html"

CSS_MARKER = '<link rel="stylesheet" href="assets/styles.css">'
MARKED_MARKER = '<script src="vendor/marked.min.js"></script>'
APP_MARKER = '<script src="assets/app.js"></script>'


def read(relative_path: str) -> str:
    path = ROOT / relative_path
    if not path.is_file():
        raise FileNotFoundError(f"缺少文件：{path}")
    return path.read_text(encoding="utf-8")


def safe_script(source: str) -> str:
    """避免内联脚本提前闭合 <script> 标签。"""
    return re.sub(r"</script", r"<\\/script", source, flags=re.IGNORECASE)


def safe_comment(source: str) -> str:
    """HTML 注释中不能出现 --。"""
    return source.replace("--", "—")


def build() -> Path:
    html = read("index.html")
    css = read("assets/styles.css")
    app = read("assets/app.js")
    marked = read("vendor/marked.min.js")
    license_text = read("vendor/marked.LICENSE")

    for marker, name in (
        (CSS_MARKER, "样式引用"),
        (MARKED_MARKER, "marked 引用"),
        (APP_MARKER, "app.js 引用"),
    ):
        if html.count(marker) != 1:
            raise RuntimeError(f"index.html 中{name}应恰好出现一次：{marker}")

    html = html.replace(CSS_MARKER, "<style>\n" + css + "\n</style>")
    html = html.replace(
        MARKED_MARKER, "<script>\n" + safe_script(marked) + "\n</script>"
    )
    html = html.replace(
        APP_MARKER, "<script>\n" + safe_script(app) + "\n</script>"
    )

    notice = (
        "\n<!--\n"
        "  本文件内联了 marked v15.0.12（MIT License）。\n"
        "  版权与许可全文如下（HTML 注释中已将连续连字符替换为破折号）：\n\n"
        + safe_comment(license_text)
        + "\n-->\n"
    )
    html = html.replace("</body>", notice + "</body>")

    # 只在真实 HTML 标记中检查外部引用；内联的 JS / CSS / 示例文本里出现
    # href="..." 之类的字符串不算引用。
    scannable = re.sub(
        r"<(script|style)\b[^>]*>.*?</\1>", "", html, flags=re.S | re.I
    )
    external = re.findall(r'(?:src|href)="(?!data:|#)([^"]+)"', scannable)
    if external:
        raise RuntimeError("单文件版仍存在外部引用：" + ", ".join(sorted(set(external))))

    OUTPUT.write_text(html, encoding="utf-8", newline="\n")
    return OUTPUT


def main() -> int:
    try:
        output = build()
    except Exception as error:  # noqa: BLE001 - 命令行脚本直接报告错误
        print(f"打包失败：{error}", file=sys.stderr)
        return 1

    size = output.stat().st_size
    print("已生成：", output)
    print(f"文件大小：{size:,} 字节（{size / 1024:.1f} KB）")
    print("验证方式：双击该文件，或运行 node 测试/test_reader.mjs（会自动检查单文件版）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
