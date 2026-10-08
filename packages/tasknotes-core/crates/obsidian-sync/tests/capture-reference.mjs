// Explicit reference-maintenance command. Downloads hash-verified pinned code,
// executes only crypto, account request builders and Zi in an isolated VM, and
// captures public synthetic request transcripts. No upstream startup/auth/network
// code can contact a service. Never packaged in a native application.
import { createHash, scrypt, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { writeFile } from "node:fs/promises";

const sourceUrl =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-headless/0d0ec4364bfde6c715c539cf3555ff8272bb7a58/cli.js";
const sourceSha256 =
  "c6307dc72c00bcf6f22093fb3e0eb91fdc417fc9dd05884ff2c36e5a19cd0196";
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Reference download HTTP ${response.status}`);
const source = await response.text();
if (createHash("sha256").update(source).digest("hex") !== sourceSha256)
  throw new Error("Pinned source hash changed");
function segment(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start || source.indexOf(startMarker, start + 1) >= 0)
    throw new Error("Reference extraction changed");
  return source.slice(start, end);
}
const timerIds = new Set();
let timerId = 0;
const context = {
  Buffer,
  TextEncoder,
  TextDecoder,
  URL,
  console: { log() {}, debug() {}, error() {} },
  crypto: {
    subtle: webcrypto.subtle,
    getRandomValues: (bytes) => {
      if (bytes.length !== 12) throw new Error("Unexpected nonce length");
      bytes.set(Array.from({ length: 12 }, (_, index) => index));
      return bytes;
    },
  },
  require: (name) => {
    if (name !== "crypto") throw new Error("Unexpected module request");
    return { scrypt };
  },
  setTimeout: () => {
    const id = ++timerId;
    timerIds.add(id);
    return id;
  },
  setInterval: () => {
    const id = ++timerId;
    timerIds.add(id);
    return id;
  },
  clearTimeout: (id) => timerIds.delete(id),
  clearInterval: (id) => timerIds.delete(id),
  queueMicrotask,
};
const prelude = `
const captures = { accounts: [], cases: [], filters: [] };
let pullBytes = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1;
  constructor(url) { this.readyState = 0; this.url = url; this.sent = []; FakeSocket.last = this; queueMicrotask(() => { this.readyState = 1; this.onopen(); }); }
  send(data) {
    if (typeof data === 'string') {
      const request = JSON.parse(data); this.sent.push({ text: request });
      if (request.op === 'init') queueMicrotask(() => this.onmessage({ data: JSON.stringify({res:'ok',perFileMax:208666624,userId:42}) }));
      else if (request.op === 'push') queueMicrotask(() => this.onmessage({ data: JSON.stringify(request.folder || request.deleted || request.size === 0 ? {res:'ok'} : {res:'upload'}) }));
      else if (request.op === 'pull') queueMicrotask(() => {
        this.onmessage({data:JSON.stringify({deleted:false,size:pullBytes.length,pieces:pullBytes.length ? 1 : 0})});
        if (pullBytes.length) this.onmessage({data:Uint8Array.from(pullBytes).buffer});
      });
    } else { this.sent.push({binary:Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))}); queueMicrotask(() => this.onmessage({data:JSON.stringify({res:'ok'})})); }
  }
  close() { this.readyState = 3; }
}
var WebSocket = FakeSocket;
var Yr = 'https://api.obsidian.md', Ps = '', Ye = class extends Error { constructor(response) { super(response.error); this.error = response.error; } };
var Ut = async (url, options) => { captures.accounts.push({url,method:options.method,headers:{...options.headers},body:options.body ? JSON.parse(options.body) : null}); return {ok:true,json:async()=>({})}; };
`;
const program = [
  prelude,
  segment("function se(s)", "function Rs(s)"),
  segment("async function Qe(s)", "var lc="),
  segment("function W(s)", "var hg="),
  segment("var It=", "var os="),
  segment("var _t=", "var zi=WebSocket"),
  segment("var zi=WebSocket", "var es=class"),
  segment("async function z(s,e,t)", "var Kt="),
  segment("var Nt=class", "var _t="),
  `
var me = ['image','audio','video','pdf','unsupported'], hs = ['app','appearance','appearance-data','hotkey','core-plugin','core-plugin-data','community-plugin','community-plugin-data'];
(async () => {
  await As('synthetic@example.test','public-synthetic-password','123456');
  await Ds('public-synthetic-token'); await Qr('public-synthetic-token'); await Ts('public-synthetic-token',3);
  await Zr('public-synthetic-token','synthetic-vault','public-key-proof','sync-test.obsidian.md',3);
  const key = Uint8Array.from(Array.from({length:32},(_,index)=>index)).buffer;
  for (const version of [0,2,3]) {
    const cipher = await kc(version,key,'public-synthetic-salt');
    const session = new Zi(cipher); const notices = []; let ready;
    await session.connect('wss://sync-test.obsidian.md','public-synthetic-token','synthetic-vault',5,false,'Synthetic Device',version => ready = version,notice => notices.push(notice));
    const socket = FakeSocket.last;
    socket.onmessage({data:JSON.stringify({op:'ready',version:5})});
    const bytes = Uint8Array.from([0,1,2,127,128,255,10,65]).buffer;
    const hash = H(await Qe(bytes));
    await session.push('Tasks/日本語 📝.md','Tasks/Before.md',false,false,1000,2000,hash,bytes);
    pullBytes = socket.sent.find(frame=>frame.binary).binary;
    const pulled = await session.pull(6);
    await session.push('Tasks/Empty.md',null,false,false,1000,2000,H(await Qe(new ArrayBuffer(0))),new ArrayBuffer(0));
    await session.push('Tasks/Folder',null,true,false,0,0,'',null);
    await session.push('Tasks/Removed.md',null,false,true,0,0,'',null);
    await session.push('Tasks/Renamed.md','Tasks/Original.md',false,false,1000,2000,hash,bytes);
    const push = socket.sent.find(frame=>frame.text?.op==='push').text;
    socket.onmessage({data:JSON.stringify({op:'push',uid:6,path:push.path,hash:push.hash,size:push.size,ctime:1000,mtime:2000,folder:false,deleted:false,device:'Synthetic Device',user:42})});
    await session.notifyQueue.promise;
    captures.cases.push({version,keyBytes:Array.from(new Uint8Array(key)),salt:'public-synthetic-salt',frames:socket.sent,pulledBytes:Array.from(new Uint8Array(pulled)),notices,ready});
    session.disconnect();
  }
  const filter = new Nt('.obsidian'); filter.set(me,hs, ['Private']);
  for (const path of ['Tasks/A.md','Boards/A.canvas','Bases/A.base','Photo.PNG','Sound.webm','Other.bin','.hidden.md','Private/A.md','Private2/A.md','.obsidian/app.json','.obsidian/types.json','.obsidian/workspace.json','.obsidian/workspace-mobile.json','.obsidian/plugins/tasknotes/data.json','.obsidian/plugins/tasknotes/main.js','.obsidian/plugins/tasknotes/node_modules/a.js','.obsidian/themes/minimal/theme.css','.obsidian/themes/minimal/manifest.json','.obsidian/snippets/color.css','.obsidian/other.json']) {
    captures.filters.push({path,folder:false,allowed:filter.allowSyncFile(path,false)});
  }
  for (const path of ['Private','Private2','Tasks','.obsidian']) captures.filters.push({path,folder:true,allowed:filter.allowSyncFile(path,true)});
  return captures;
})()
`,
].join("\n");
const transcript = await runInNewContext(program, context, { timeout: 5000 });
await writeFile(
  new URL("reference/protocol.json", import.meta.url),
  `${JSON.stringify({ sourceUrl, sourceSha256, transcript }, null, 2)}\n`,
);
if (timerIds.size) throw new Error("Reference harness left timers active");
console.log(
  `Captured official protocol requests for ${transcript.cases.length} encryption versions`,
);
