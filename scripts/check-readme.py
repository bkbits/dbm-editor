#!/usr/bin/env python3
"""README.md 链接与表格校验：图片/相对文件引用存在性、内部锚点(GitHub slug 规则)解析、表格列数一致性"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = (ROOT / 'README.md').read_text(encoding='utf-8')
errors: list[str] = []

# 1. 非 http 链接目标存在性
for target in sorted(set(re.findall(r'\]\((?!#|http)([^)]+)\)', README))):
    if not (ROOT / target).exists():
        errors.append(f'缺失引用: {target}')

# 2. GitHub slug 生成（小写、去除非字母数字空格连字符的字符、空格转连字符；CJK 视作字母）
def slug(heading: str) -> str:
    text = heading.strip().lower()
    text = re.sub(r'[^\w\s-]', '', text, flags=re.UNICODE)  # \w 含 CJK 与下划线
    return re.sub(r'\s', '-', text)  # GitHub 规则：每个空格各转一个连字符（不合并）

slugs = {slug(h) for h in re.findall(r'^#{2,3}\s+(.+)$', README, re.M)}

# 3. 内部锚点链接可解析
for anchor in sorted(set(re.findall(r'\]\(#([^)]+)\)', README))):
    if anchor not in slugs:
        errors.append(f'锚点无法解析: #{anchor}')

# 4. 表格列数一致性（同一表格块内各行管道数相同）
for block in re.findall(r'(?:^\|.*\|\s*$\n?)+', README, re.M):
    rows = [r for r in block.strip().splitlines() if r.strip()]
    if not rows:
        continue
    cols = {row.count('|') for row in rows}
    if len(cols) > 1:
        first = rows[0][:60]
        errors.append(f'表格列数不一致 ({sorted(cols)}): {first}...')

# 5. 代码块闭合
if README.count('```') % 2 != 0:
    errors.append('代码块未闭合（``` 数量为奇数）')

if errors:
    print('\n'.join(f'✗ {e}' for e in errors))
    sys.exit(1)
print(f'✓ 校验通过：{len(slugs)} 个标题、内部锚点全部可解析、引用文件全部存在、表格列数一致、代码块闭合')
