import json

with open(r'www.pinterest.com.har', encoding='utf-8') as f:
    har = json.load(f)

entries = har['log']['entries']
print('Total entries:', len(entries))
for i, e in enumerate(entries):
    url = e['request']['url']
    method = e['request']['method']
    print('[%d] %s %s' % (i, method, url[:120]))
    if 'postData' in e['request']:
        pd = e['request']['postData']
        text = pd.get('text', '')
        print('  POST DATA:', text[:300])
    resp = e.get('response', {})
    ct = resp.get('content', {}).get('text', '')
    if ct and len(ct) > 10:
        print('  RESPONSE (first 300):', ct[:300])
    print()
