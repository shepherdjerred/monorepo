const path = ".cache/replay-spike/research/cdp-final-check.mjs";
let s = await Bun.file(path).text();
const a = s.indexOf("\n await controls(false,1,68.5)"),
  b = s.indexOf("\n await controls(true,1,82.35)");
if (a < 0 || b <= a) throw Error("Capture slice missing");
s = s.slice(0, a) + s.slice(b);
const marker = "\n const shot=await c.send('Page.captureScreenshot'";
const at = s.indexOf(marker);
if (at < 0) throw Error("Screenshot marker missing");
s =
  s.slice(0, at) +
  `\n if(!meta.repeatSeek.imagesEqual){meta.worldOnly=[];for(const t of [82.35,74,82.35]){await controls(false,1,t);await sleep(1800);const shot=await c.send('Page.captureScreenshot',{format:'png'}),path=stem+'-world-only-'+meta.worldOnly.length+'.png';await Bun.write(path,Buffer.from(shot.data,'base64'));meta.worldOnly.push({time:t,path,state:await state()});}}` +
  s.slice(at);
await Bun.write(".cache/replay-spike/research/cdp-capture-sync-check.mjs", s);
