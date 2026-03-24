import sys, re

with open('E:/Shanzi/frontend/ai-chat.html', encoding='utf-8') as f:
    lines = f.readlines()
    content = ''.join(lines)

script_start_line = next(i for i, l in enumerate(lines) if '<script>' in l)
script_end_line   = next(i for i, l in enumerate(lines) if '</script>' in l)

print(f'Script spans lines {script_start_line+1} to {script_end_line+1}')

script_lines = lines[script_start_line:script_end_line]

# Check for backslash before any unexpected character in JS
bs = chr(92)
issues = []
for i, line in enumerate(script_lines):
    lineno = script_start_line + i + 1
    for j, ch in enumerate(line):
        if ch == bs and j+1 < len(line):
            next_ch = line[j+1]
            # In JS, valid escapes in string: n r t b f v 0 ' " ` \ u x
            # Backslash before anything else outside a string is unexpected
            if next_ch not in ('n','r','t','b','f','v','0',"'",'`','"','\\','u','x','\n',' ','/','-','*','d','s','w','W','S','D'):
                issues.append((lineno, j, next_ch, line.rstrip()))

print(f'Suspicious backslash sequences: {len(issues)}')
for lineno, col, ch, line in issues[:20]:
    print(f'  line {lineno} col {col}: \\{repr(ch)} -> {line[:80]}')

# Also check for any non-ASCII in JS that might cause issues
non_ascii_lines = []
for i, line in enumerate(script_lines):
    lineno = script_start_line + i + 1
    for ch in line:
        if ord(ch) > 127:
            # Emojis in template literals are fine, but check for corrupt sequences
            if 0xD800 <= ord(ch) <= 0xDFFF:  # surrogate pairs - bad
                non_ascii_lines.append((lineno, hex(ord(ch)), line.rstrip()))
                break

print(f'Surrogate/corrupt chars: {len(non_ascii_lines)}')
for lineno, cp, line in non_ascii_lines[:5]:
    print(f'  line {lineno}: {cp} -> {line[:80]}')
