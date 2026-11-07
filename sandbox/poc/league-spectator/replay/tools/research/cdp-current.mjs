import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser();
console.log(
  JSON.stringify(
    await c.evaluate(
      `({url:location.href,status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,clock:document.querySelector('#clock')?.textContent,play:document.querySelector('#play')?.textContent,seek:document.querySelector('#seek')?.value,inner:[innerWidth,innerHeight,devicePixelRatio],canvases:[...document.querySelectorAll('canvas')].map(x=>({w:x.width,h:x.height,rect:x.getBoundingClientRect().toJSON()})),diagnostics:Object.keys(globalThis.replayEffectDiagnostics??{})})`,
    ),
    null,
    2,
  ),
);
c.close();
