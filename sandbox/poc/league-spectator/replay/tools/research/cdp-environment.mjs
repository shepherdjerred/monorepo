import { connectReplayBrowser } from "./cdp-client.mjs";
const c = await connectReplayBrowser();
console.log(
  JSON.stringify(
    await c.evaluate(
      `({visibility:document.visibilityState,focus:document.hasFocus(),hardwareConcurrency:navigator.hardwareConcurrency,userAgent:navigator.userAgent,ui:document.querySelector('#performance-status').textContent,error:document.querySelector('#error').textContent})`,
    ),
  ),
);
c.close();
