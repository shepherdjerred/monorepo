import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser();
await c.send("Emulation.setDeviceMetricsOverride", {
  width: 2210,
  height: 1158,
  deviceScaleFactor: 1,
  mobile: false,
});
await new Promise((r) => setTimeout(r, 1000));
console.log(
  JSON.stringify(
    await c.evaluate(
      `(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {viewport:[innerWidth,innerHeight,devicePixelRatio],canvas:[canvas.width,canvas.height],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),status:document.querySelector('#status').textContent}})()`,
    ),
    null,
    2,
  ),
);
c.close();
