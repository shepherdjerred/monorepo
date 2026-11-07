import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser();
try {
  console.log(
    JSON.stringify(
      await c.evaluate(
        `({url:location.href,status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,play:document.querySelector('#play')?.textContent,time:Number(document.querySelector('#seek')?.value),canvas:[document.querySelector('canvas')?.width,document.querySelector('canvas')?.height,devicePixelRatio],diagnostics:typeof replayEffectDiagnostics})`,
      ),
    ),
  );
} finally {
  c.close();
}
