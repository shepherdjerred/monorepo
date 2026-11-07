import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser(),
  stem =
    process.argv[2] ??
    ".cache/replay-spike/research/browser-cdp-v38-projectile-video";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 2210,
    height: 1158,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.evaluate(
    `(()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click();const s=document.querySelector('#speed'),t=document.querySelector('#seek');s.value='1';s.dispatchEvent(new Event('change'));t.value='78.75';t.dispatchEvent(new Event('input'));[...document.querySelectorAll('#roster button')].find(b=>b.textContent.trim().startsWith('Akshan')).click()})()`,
  );
  await sleep(1000);
  const before = await c.evaluate(
    `({time:Number(document.querySelector('#seek').value),canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height,devicePixelRatio]})`,
  );
  await c.evaluate(
    `(()=>{if(!MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))throw Error('VP8 capture required');const stream=document.querySelector('canvas').captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:4500000}),chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};globalThis.__replayMediaCapture={stream,recorder,chunks};recorder.start();document.querySelector('#play').click()})()`,
  );
  await sleep(4500);
  const result = await c.evaluate(
    `(async()=>{const p=document.querySelector('#play');if(p.textContent.trim()==='Pause')p.click();const {recorder,stream,chunks}=globalThis.__replayMediaCapture;await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop()});stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:recorder.mimeType}),url=URL.createObjectURL(blob);const video=document.createElement('video');video.muted=true;video.src=url;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject});video.currentTime=1;await new Promise(resolve=>video.onseeked=resolve);const preview=document.createElement('canvas');preview.width=960;preview.height=540;preview.getContext('2d').drawImage(video,0,0,960,540);const thumbnail=preview.toDataURL('image/png');video.removeAttribute("src");video.load();URL.revokeObjectURL(url);const data=await new Promise(resolve=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.readAsDataURL(blob)});delete globalThis.__replayMediaCapture;return{data,thumbnail,mimeType:recorder.mimeType,bytes:blob.size,time:Number(document.querySelector('#seek').value),error:document.querySelector('#error').textContent}})()`,
  );
  if (result.error) throw Error(result.error);
  await Bun.write(
    stem + ".webm",
    Buffer.from(result.data.split(",")[1], "base64"),
  );
  await Bun.write(
    stem + "-preview.png",
    Buffer.from(result.thumbnail.split(",")[1], "base64"),
  );
  delete result.data;
  delete result.thumbnail;
  await Bun.write(
    stem + ".json",
    JSON.stringify(
      {
        scope:
          "Actual ordinary1x browser canvas recording, MediaRecorder overhead; not FPS acceptance",
        before,
        after: result,
        events: c.events,
        loadedSourceReference:
          ".cache/replay-spike/research/browser-cdp-v38-primary-controls.json",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ before, after: result, errors: c.events.length }),
  );
} finally {
  c.close();
}
