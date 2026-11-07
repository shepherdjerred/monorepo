import json
from PIL import Image
from pathlib import Path
root=Path('.cache/replay-lineup-5667809143/research')
r=json.loads((root/'browser-cdp-v37-visual.json').read_text())
frames=[]
for f in r['frames']:
 im=Image.open(f['path']).convert('RGB');im.thumbnail((1105,579));frames.append(im)
times=[f['state']['time'] for f in r['frames']]
durations=[max(100,int((times[min(i+1,len(times)-1)]-t)*1000)) for i,t in enumerate(times)]
frames[0].save(root/'browser-cdp-v37-visual.gif',save_all=True,append_images=frames[1:],duration=durations,loop=0)
print(json.dumps({'gif':str(root/'browser-cdp-v37-visual.gif'),'nonempty':[f['state'] for f in r['frames'] if not f['state']['particles'].startswith('0 effect')]}))
