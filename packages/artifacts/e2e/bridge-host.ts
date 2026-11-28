/**
 * Browser-side stand-in for the viewer's bridge host, installed with
 * `page.addInitScript` as plain text so it can use the page's globals. It
 * frames a URL in a sandboxed iframe (no allow-same-origin), answers `hello`
 * with `init` plus a `MessagePort`, and records every port message in
 * `window.hosted`.
 */
export const BRIDGE_HOST_SCRIPT = `
window.hosted = [];
window.hostFrame = function (source) {
  var frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups");
  frame.style.cssText = "position:fixed;left:0;top:0;width:800px;height:600px;border:0";
  return new Promise(function (resolve) {
    window.addEventListener("message", function (event) {
      if (event.source !== frame.contentWindow || event.origin !== "null") return;
      if (!event.data || event.data.t !== "hello") return;
      var channel = new MessageChannel();
      channel.port1.addEventListener("message", function (message) {
        window.hosted.push(message.data);
      });
      channel.port1.start();
      window.hostPort = channel.port1;
      frame.contentWindow.postMessage({ ab: 1, t: "init", mode: "focus", scale: 1 }, "*", [channel.port2]);
      resolve(true);
    });
    frame.src = source;
    document.body.append(frame);
  });
};
`;
