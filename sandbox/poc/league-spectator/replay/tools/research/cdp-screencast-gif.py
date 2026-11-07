import json,sys
from pathlib import Path
from PIL import Image
stem=Path(sys.argv[1])
report=json.loads(stem.with_suffix('.json').read_text())
frames=[]
for frame in report['frames']:
    image=Image.open(frame['path']).convert('RGB')
    image.thumbnail((1105,579))
    frames.append(image)
times=[frame['metadata']['timestamp'] for frame in report['frames']]
durations=[max(10,round((times[i+1]-time)*1000)) if i+1<len(times) else 100 for i,time in enumerate(times)]
target=stem.with_suffix('.gif')
frames[0].save(target,save_all=True,append_images=frames[1:],duration=durations,loop=0)
print(json.dumps({'gif':str(target),'frames':len(frames),'wallSeconds':times[-1]-times[0],'firstReplayTime':report['before']['time'],'lastReplayTime':report['after']['time']}))
