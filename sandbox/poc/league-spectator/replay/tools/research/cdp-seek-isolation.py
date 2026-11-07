from PIL import Image,ImageChops
import json
stem='.cache/replay-spike/research/browser-cdp-v37-capture-sync-primary'
rows=[]
for label,pa,pb,crop in [('effects',stem+'-seek-0.png',stem+'-seek-2.png',None),('world-only',stem+'-world-only-0.png',stem+'-world-only-2.png',(0,78,1920,1158))]:
 a=Image.open(pa).convert('RGB');b=Image.open(pb).convert('RGB')
 if crop:a=a.crop(crop);b=b.crop(crop)
 d=ImageChops.difference(a,b);pixels=sum(p!=(0,0,0) for p in d.get_flattened_data());d.save(stem+'-'+label+'-difference.png');rows.append({'mode':label,'changedPixels':pixels,'bbox':d.getbbox(),'extrema':d.getextrema()})
print(json.dumps(rows))
