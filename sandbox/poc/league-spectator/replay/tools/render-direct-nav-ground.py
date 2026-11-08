"""Replay source-owned nav producer and retained ground controls through GLES.

Uses the same GLES consumer as both actual replay raster diagnostics. This is
explicit placement-control evidence, not native-world or browser pixel parity.
"""
import argparse
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageDraw
from offscreen_nav_ground import OwnedNavGroundReplay, RayDraw, adapter


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path)
    parser.add_argument('--proof',type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=adapter.sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Ground raster input drift: '+str(path))
        inputs[str(path)]=digest;return data
    read=lambda path:json.loads(raw(path))
    proof=read(args.proof or cache/'research/direct-nav-ground-renderer-commands.json')
    if not proof['scope']['explicitPlacementControl'] or proof['scope']['actualDecodedMatchPlacement']:
        raise ValueError('Explicit original-source retained-runtime placement control required')
    native=read(cache/'research/navmesh-producer-v29/native-high.json')
    for name in ['libEGL.dll','libGLESv2.dll']:raw(args.angle/name)
    tools=Path(__file__).resolve().parent
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(tools):raw(path)
    raw(__file__)
    renderer=RayDraw(args.angle);replay=None;draws=[];pictures=[]
    try:
        replay=OwnedNavGroundReplay(renderer,cache,proof,raw)
        for frame in proof['frames']:
            replay.advance(frame['time'],native)
            for draw in frame['draws']:
                pixels,submitted=replay.draw(frame['time'],draw)
                changed=int(np.count_nonzero(np.any(pixels!=np.array([6,9,14,255],dtype=np.uint8),axis=2)))
                draws.append({**{key:draw[key] for key in ['sourceEventId','generation','definitionId','emitterId','ownerId','ownershipStatus']},
                    'time':frame['time'],'changedPixels':changed,'rgbaSha256':adapter.sha(pixels.tobytes()),'submitted':submitted})
            for index,draw in enumerate(frame['draws']):pixels,_=replay.draw(frame['time'],draw,clear=index==0)
            pictures.append((frame['time'],pixels))
        producer_observations=replay.observations
    finally:
        if replay:replay.close()
        renderer.close()
    for path,digest in inputs.items():
        if adapter.sha(Path(path).read_bytes())!=digest:raise ValueError('Ground raster final source drift: '+path)
    canvas=Image.new('RGB',(1536,560),(14,24,40));ink=ImageDraw.Draw(canvas)
    for index,(time,pixels) in enumerate(pictures):
        canvas.paste(Image.fromarray(pixels).convert('RGB'),(index*512,38))
        ink.text((index*512+12,12),f'{time:.2f}s - actual owned navigation + retained ground draws',fill=(235,240,250))
    picture=cache/'visuals'/((args.output.stem if args.output else 'direct-nav-ground-renderer')+'.png');canvas.save(picture)
    result={'schema':1,'kind':'owned-navigation-ground-gles-command-replay','inputs':inputs,
        'producerObservations':producer_observations,'draws':draws,'image':str(picture),'imageSha256':adapter.sha(picture.read_bytes()),
        'counts':{'producerPasses':len(producer_observations),'groundSubmissions':len(draws),
            'positiveGroundDraws':sum(draw['changedPixels']>0 for draw in draws),
            'positiveComponents':len({(draw['definitionId'],draw['emitterId']) for draw in draws if draw['changedPixels']>0})},
        'scope':{'actualGlesShaderLinkAndDraw':True,'sameGlesConsumerAsActualReplayRasters':True,
            'ownedNavigationOutputBoundWithoutReadback':True,'producerReadbackForComparisonOnly':True,
            'originalFullNativePass5MaterialInputs':True,'explicitPlacementControl':True,'actualDecodedMatchPlacement':False,
            'threeWebGlBackendExecuted':False,'nativeMetalPixelsCompared':False,'nativeWorldPixelParity':False,'matchCoverageClaimed':False}}
    output=args.output or cache/'research/direct-nav-ground-renderer-offscreen.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__=='__main__':main()
