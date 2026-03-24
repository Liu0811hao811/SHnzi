import sys, re

with open('E:/Shanzi/frontend/ai-chat.html', encoding='utf-8') as f:
    content = f.read()

script_start = content.find('<script>')
script_end   = content.rfind('</script>')
script = content[script_start:script_end]

# Find backslash before ! (already fixed) or other unexpected escapes
bs_bang = [(m.start(), content[script_start+m.start()-3:script_start+m.start()+8])
           for m in re.finditer(r'\\\!', script)]
sys.stdout.write('backslash-! in script: ' + str(len(bs_bang)) + '\n')
for pos, ctx in bs_bang[:5]:
    sys.stdout.write('  ' + repr(ctx) + '\n')

# Backtick count (template literals should come in pairs within non-strings)
bt_count = script.count('`')
sys.stdout.write('backtick count: ' + str(bt_count) + ' (' + ('even OK' if bt_count % 2 == 0 else 'ODD - possible error') + ')\n')

# Check for toggleMerchant definition
if 'function toggleMerchant' in script:
    sys.stdout.write('toggleMerchant: FOUND\n')
else:
    sys.stdout.write('toggleMerchant: MISSING\n')

# Check for setImageMode definition
if 'function setImageMode' in script:
    sys.stdout.write('setImageMode: FOUND\n')
else:
    sys.stdout.write('setImageMode: MISSING\n')
