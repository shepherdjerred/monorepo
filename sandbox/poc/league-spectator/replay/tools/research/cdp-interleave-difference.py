from PIL import Image,ImageChops
import json
s='.cache/replay-spike/research/browser-cdp-v37-interleaved-world-fx'
rows=[]
for mode in ['world','fx']:
 a=Image.open(s+'-'+mode+'-0.png').convert('RGB');b=Image.open(s+'-'+mode+'-2.png').convert('RGB')
 if mode=='world':a=a.crop((0,78,1920,1158));b=b.crop((0,78,1920,1158))
 d=ImageChops.difference(a,b);d.save(s+'-'+mode+'-difference.png');rows.append({'mode':mode,'changedPixels':sum(x!=(0,0,0) for x in d.get_flattened_data()),'bbox':d.getbbox(),'extrema':d.getextrema()})
print(json.dumps(rows))
