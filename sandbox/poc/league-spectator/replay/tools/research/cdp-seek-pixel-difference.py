from PIL import Image,ImageChops
import json
p='.cache/replay-spike/research/browser-cdp-v37-final-primary-seek-'
a=Image.open(p+'0.png').convert('RGBA');b=Image.open(p+'2.png').convert('RGBA');d=ImageChops.difference(a,b);rgb=d.convert('RGB');count=sum(x!=(0,0,0) for x in rgb.getdata());rgb.save(p+'difference.png');print(json.dumps({'differentPixels':count,'boundingBox':rgb.getbbox(),'extrema':rgb.getextrema()}))
