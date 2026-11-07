from PIL import Image,ImageChops
p='.cache/replay-spike/research/browser-cdp-v37-final-primary-seek-'
a=Image.open(p+'0.png').convert('RGB');b=Image.open(p+'2.png').convert('RGB');box=(910,490,985,550)
for n,im in [('before',a),('after',b),('difference',ImageChops.difference(a,b))]:im.crop(box).resize((600,480)).save(p+n+'-crop.png')
