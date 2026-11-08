"""Crop saved mixed offscreen GIF pixels; never regenerate a draw/projection."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);args=p.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();b=path.read_bytes();h=hashlib.sha256(b).hexdigest()
        if str(path) in inputs and inputs[str(path)]!=h:raise ValueError('Crop input changed')
        inputs[str(path)]=h;return b
    def read(path):return json.loads(raw(path))
    raster=read(cache/'research/shared-direct-playback-offscreen-v35.json');worker=read(cache/'research/shared-direct-playback-worker-v35-final.json')
    raw(__file__);raw(Path(__file__).with_name('render-shared-direct-playback.py'))
    source=Path(raster['capture']['path']);raw(source)
    if inputs[str(source.resolve())]!=raster['capture']['sha256']:raise ValueError('Exact published mixed GIF required')
    frame_indices=list(range(23,32));selected=[26,27,28];identities=[];points=[];projection=np.array(raster['projection']).reshape(4,4)
    for i in frame_indices:
        frame=worker['snapshots'][i]
        if frame['time']!=raster['frames'][i]['time']:raise ValueError('Exact worker/raster frame ordering required')
        for draw in frame['draws']:
            if draw['definitionId']!='champions/karthus/10/ce863744' or draw['emitterId']!=4:continue
            identity={k:draw[k] for k in ['sourceEventId','generation','definitionId','emitterId']}
            if identity not in identities:identities.append(identity)
            if not any(all(d[k]==v for k,v in identity.items()) and d['prefixFramebufferChangedPixels']>0 for d in raster['frames'][i]['draws']):raise ValueError('Selected component must have positive prefix contribution')
            xyz=np.array(draw['positions']).reshape(-1,3);clip=np.column_stack([xyz,np.ones(len(xyz))])@projection.T;ndc=clip[:,:2]/clip[:,3,None]
            points.extend(np.column_stack([74+(ndc[:,0]+1)*256,50+(1-ndc[:,1])*256]).tolist())
    if len(identities)!=2:raise ValueError('Exact first two added component instances required')
    center=np.array(points).mean(axis=0);left=max(74,min(74+512-96,int(math.floor(center[0]-48))));top=max(50,min(50+512-96,int(math.floor(center[1]-48))));box=(left,top,left+96,top+96)
    gif=Image.open(source);crops=[];records=[]
    for i in frame_indices:
        gif.seek(i);rgb=gif.convert('RGB');crop=rgb.crop(box);crops.append(crop)
        records.append({'gifFrameIndex':i,'replayTime':raster['frames'][i]['time'],'sourceFrameDecodedRGBSha256':hashlib.sha256(rgb.tobytes()).hexdigest(),'cropDecodedRGBSha256':hashlib.sha256(crop.tobytes()).hexdigest(),'cropRectangleLTRB':list(box),'sourceDurationMs':gif.info.get('duration')})
    folder=cache/'visuals';png=folder/'depth-bias-mixed-v35.png';animation=folder/'depth-bias-mixed-v35.gif';preview=folder/'depth-bias-mixed-v35-preview.png'
    crops[frame_indices.index(27)].save(png)
    crops[0].save(animation,save_all=True,append_images=crops[1:],duration=[r['sourceDurationMs'] for r in records],loop=0)
    sheet=Image.new('RGB',(3*384,430),'#101822');label=ImageDraw.Draw(sheet)
    for column,i in enumerate(selected):
        sheet.paste(crops[frame_indices.index(i)].resize((384,384),Image.Resampling.NEAREST),(column*384,46));label.text((column*384+8,6),f"{raster['frames'][i]['time']:.3f}s / mixed offscreen",fill='white');label.text((column*384+8,22),'4x nearest pixels; overlapping effects',fill='#a8bdd0')
    sheet.save(preview)
    outputs=[]
    for path in [png,animation,preview]:
        b=path.read_bytes();outputs.append({'path':str(path),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
    for path,h in inputs.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=h:raise ValueError('Crop source drift')
    output=cache/'research/direct-depth-bias-visual-crop-v35.json';output.write_text(json.dumps({'schema':1,'kind':'saved-mixed-offscreen-gif-faithful-depth-bias-crop','artifactVersion':35,'inputs':inputs,'sourceCapture':raster['capture'],'sourceFrameSize':list(gif.size),'rasterInsetLTRB':[74,50,586,562],'projection':raster['projection'],'componentIdentities':identities,'frames':records,'singlePNGFrameIndex':27,'previewFrameIndices':selected,'outputs':outputs,'scope':{'originalProjectionAndDrawsUnchanged':True,'sourceGIFPaletteQuantizationAlreadyPresent':True,'singlePNGPreservesDecodedRGBPixels':True,'animatedGIFMayRequantizeDecodedPaletteColors':True,'previewNearestNeighborIntegerReplication':4,'mixedEffectsOverlap':True,'isolatedComponentPixelsClaimed':False,'browserAcceptance':False}},indent=2),encoding='utf-8');print(json.dumps({'output':str(output),'rectangle':box,'frames':frame_indices,'outputs':outputs}))


if __name__=='__main__':main()
