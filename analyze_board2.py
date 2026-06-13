import re

with open(r'pin-creation-tool.html', encoding='utf-8', errors='ignore') as f:
    html = f.read()

# Find the board-dropdown-select-button section
idx = html.find('board-dropdown-select-button')
if idx >= 0:
    print('=== board-dropdown-select-button context (+-500 chars) ===')
    print(html[max(0, idx-200):idx+600])
    print()

# Find board-dropdown-placeholder
idx2 = html.find('board-dropdown-placeholder')
if idx2 >= 0:
    print('=== board-dropdown-placeholder context (+-500 chars) ===')
    print(html[max(0, idx2-200):idx2+600])
    print()

# Find storyboard-selector-board
idx3 = html.find('storyboard-selector-board')
if idx3 >= 0:
    print('=== storyboard-selector-board context ===')
    print(html[max(0, idx3-100):idx3+800])
