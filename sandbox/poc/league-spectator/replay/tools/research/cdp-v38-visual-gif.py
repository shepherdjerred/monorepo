import json
from pathlib import Path
from PIL import Image
root=Path('.cache/replay-spike/research')
stem='browser-cdp-v38-akshan-visual'
report=json.loads((root/(stem+'.json')).read_text())
frames=[]
for frame in report['frames']:
    image=Image.open(frame['path']).convert('RGB')
    image.thumbnail((1105,579))
    frames.append(image)
times=[frame['state']['time'] for frame in report['frames']]
durations=[max(100,round((times[i+1]-time)*1000)) if i+1<len(times) else 550 for i,time in enumerate(times)]
target=root/(stem+'.gif')
frames[0].save(target,save_all=True,append_images=frames[1:],duration=durations,loop=0)
print(json.dumps({'gif':str(target),'frames':len(frames),'first':times[0],'last':times[-1],'scope':'actual ordinary playback; screenshot readback overhead; not FPS acceptance'}))
