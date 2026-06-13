import re

with open(r'pin-creation-tool.html', encoding='utf-8', errors='ignore') as f:
    html = f.read()

# After clicking board-dropdown-select-button, search inputs or option lists appear
# Let's look for any listbox/option/combobox related to boards

# Find all role="option" elements and surrounding text
options = [(m.start(), m.group()) for m in re.finditer(r'role="option"', html)]
print('role="option" count:', len(options))
for start, _ in options[:3]:
    print(html[max(0,start-50):start+300])
    print('---')

# Look for "Boards" search input placeholder
search_results = re.findall(r'.{0,100}[Ss]earch.{0,30}board.{0,100}', html)
for s in search_results[:3]:
    print('SEARCH:', s[:200])

# Look for data-test-id attributes related to boards in a list/options context
all_test_ids = re.findall(r'data-test-id="([^"]+)"', html)
unique_ids = sorted(set(all_test_ids))
print('\nAll unique data-test-id values:')
for tid in unique_ids:
    print(' ', tid)
