from html.parser import HTMLParser
import re

with open(r'pin-creation-tool.html', encoding='utf-8', errors='ignore') as f:
    html = f.read()

# Find board-related data-test-id attributes
board_ids = re.findall(r'data-test-id="([^"]*board[^"]*)"', html, re.IGNORECASE)
print('=== data-test-id with "board" ===')
for b in set(board_ids):
    print(' ', b)

# Find aria-label with board
aria_boards = re.findall(r'aria-label="([^"]*[Bb]oard[^"]*)"', html)
print('\n=== aria-label with "board" ===')
for b in set(aria_boards):
    print(' ', b)

# Find combobox or listbox elements
combos = re.findall(r'role="(combobox|listbox|option)"[^>]*>', html)
print('\n=== combobox/listbox count:', len(combos))

# Find placeholder with board  
placeholders = re.findall(r'placeholder="([^"]*[Bb]oard[^"]*)"', html)
print('\n=== placeholders with board ===')
for p in set(placeholders):
    print(' ', p)

# Find the board selector section - look for surrounding context
board_section = re.findall(r'.{0,200}board.{0,200}', html, re.IGNORECASE)
print('\n=== Snippets containing "board" (first 5) ===')
for i, s in enumerate(board_section[:5]):
    print(f'[{i}]', s.replace('\n', ' ')[:300])
    print()
