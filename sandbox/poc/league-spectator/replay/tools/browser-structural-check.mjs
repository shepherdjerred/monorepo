// Verify the research page through PinchTab in an owned, isolated Chrome profile.
// The API token lives only in process memory; default security gates stay enabled.
import { resolve } from "node:path";

const [
  binaryPath,
  statePath,
  outputPath,
  mode = "structural",
  originArg = "http://127.0.0.1:4180",
] = process.argv.slice(2);
if (!["structural", "latest"].includes(mode))
  throw Error("Unknown browser research mode");
if (!outputPath)
  throw Error(
    "Usage: bun tools/browser-structural-check.mjs <pinchtab.exe> <ignored-state-dir> <screenshot.png> [structural|latest] [preview-origin]",
  );
if (process.platform !== "win32")
  throw Error("This process-tree cleanup is Windows-specific");
const binary = resolve(binaryPath),
  root = resolve(statePath),
  config = resolve(root, "config.json"),
  preview = new URL(originArg);
if (
  preview.href !== preview.origin + "/" ||
  !(
    preview.origin === "http://127.0.0.1:4180" ||
    (preview.protocol === "https:" &&
      preview.hostname.endsWith(".ts.net") &&
      !preview.port)
  )
)
  throw Error(
    "Expected the local preview origin or a private Tailscale HTTPS origin",
  );
const token = crypto.randomUUID() + crypto.randomUUID();
const env = {
  ...process.env,
  PINCHTAB_CONFIG: config,
  PINCHTAB_TOKEN: token,
  OP_SERVICE_ACCOUNT_TOKEN: undefined,
};
await Bun.write(
  config,
  JSON.stringify({
    configVersion: "0.8.0",
    server: {
      bind: "127.0.0.1",
      port: "9868",
      stateDir: resolve(root, "state"),
      logLevel: "warn",
    },
    browser: {
      binary: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
    instanceDefaults: { mode: "headless", noRestore: true },
    profiles: {
      baseDir: resolve(root, "profiles"),
      defaultProfile: "replay-research",
    },
    security: {
      allowEvaluate: false,
      allowMacro: false,
      allowScreencast: false,
      allowDownload: false,
      allowCookies: false,
      allowUpload: false,
      allowClipboard: false,
      allowFileScheme: false,
      allowedDomains: ["127.0.0.1", "localhost", "::1", preview.hostname],
      attach: {
        enabled: false,
        allowHosts: ["127.0.0.1", "localhost", "::1"],
        allowSchemes: ["ws", "wss", "http", "https"],
        forwardProxyAuth: false,
      },
      idpi: {
        enabled: true,
        strictMode: true,
        scanContent: true,
        wrapContent: true,
      },
    },
  }),
);
let logs = "";
const clean = (value) => value.replaceAll(token, "[redacted]");
const bridge = Bun.spawn(
  [binary, "bridge", "--port", "9868", "--bind", "127.0.0.1"],
  { env, stdout: "pipe", stderr: "pipe" },
);
const drain = async (stream) => {
  for await (const bytes of stream)
    logs += clean(new TextDecoder().decode(bytes));
};
const drains = [drain(bridge.stdout), drain(bridge.stderr)];
async function cli(args) {
  const child = Bun.spawn(
    [binary, "--server", "http://127.0.0.1:9868", ...args],
    { env, stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => child.kill(), 20000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw Error(clean(stderr || stdout));
    return clean(stdout);
  } finally {
    clearTimeout(timer);
  }
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:9868/health", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    if (bridge.exitCode !== null) throw Error(`Browser bridge exited: ${logs}`);
    await Bun.sleep(200);
  }
  if (!ready) throw Error(`Browser startup timeout: ${logs}`);
  const page = `${preview.origin}/${mode === "latest" ? "latest.html" : "structural-check.html"}`;
  const navigation = JSON.parse(await cli(["nav", page, "--json"]));
  const tab = navigation.tabId;
  if (!tab || navigation.url !== page) throw Error("Unexpected research tab");
  async function clickNamedButton(name) {
    const snapshot = JSON.parse(await cli(["snap", "--json", "--tab", tab]));
    const buttons = snapshot.nodes.filter(
      (node) => node.role === "button" && node.name === name,
    );
    if (buttons.length !== 1)
      throw Error(`Expected one research button: ${name}`);
    await cli(["click", buttons[0].ref, "--json", "--tab", tab]);
  }
  async function untilText(selector, expected) {
    for (let attempt = 0; attempt < 160; attempt++) {
      const text = await cli([
        "text",
        "--selector",
        selector,
        "--full",
        "--tab",
        tab,
      ]);
      if (text.includes(expected)) return text;
      if (/RuntimeError|Error:/.test(text)) throw Error(text);
      if (mode === "latest" && text.includes("Research view stopped"))
        throw Error(
          await cli(["text", "--selector", "#error", "--full", "--tab", tab]),
        );
      await Bun.sleep(250);
    }
    throw Error(`Browser result timeout: ${selector}`);
  }
  if (mode === "latest") {
    await untilText("#status", "Map ready");
    await clickNamedButton("Decode local replay");
    const result = await untilText("#status", "Ready · 10 champions");
    if (!result.includes("2,343 path records"))
      throw Error("Unexpected latest movement count");
    await cli([
      "screenshot",
      "--tab",
      tab,
      "-o",
      resolve(outputPath),
      "--beyond-viewport",
    ]);
    await clickNamedButton("Jump to dash");
    await untilText("#action-status", "recorded forced movement");
    await untilText("#camera-status", "Following");
    await cli([
      "screenshot",
      "--tab",
      tab,
      "-o",
      resolve(outputPath).replace(/\.png$/, "-motion.png"),
      "--beyond-viewport",
    ]);
    await clickNamedButton("Jump to recorded action");
    await untilText("#action-status", "Spell");
    await untilText("#camera-status", "Following");
    await cli([
      "screenshot",
      "--tab",
      tab,
      "-o",
      resolve(outputPath).replace(/\.png$/, "-action.png"),
      "--beyond-viewport",
    ]);
    const actionSnapshot = JSON.parse(
      await cli(["snap", "--json", "--tab", tab]),
    );
    const actionSeek = actionSnapshot.nodes.find(
      (n) => n.role === "slider" && n.name === "Replay time",
    );
    if (!actionSeek) throw Error("Action seek control absent");
    for (let i = 0; i < 8; i++)
      await cli(["press", actionSeek.ref, "ArrowRight", "--tab", tab]);
    await cli([
      "screenshot",
      "--tab",
      tab,
      "-o",
      resolve(outputPath).replace(/\.png$/, "-action-later.png"),
      "--beyond-viewport",
    ]);
    await clickNamedButton("Jump to recorded attack");
    await untilText("#action-status", "attack");
    await cli([
      "screenshot",
      "--tab",
      tab,
      "-o",
      resolve(outputPath).replace(/\.png$/, "-attack.png"),
      "--beyond-viewport",
    ]);
    await clickNamedButton("Play");
    const clockBefore = await cli([
      "text",
      "--selector",
      "#clock",
      "--full",
      "--tab",
      tab,
    ]);
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(200);
      const next = await cli([
        "text",
        "--selector",
        "#clock",
        "--full",
        "--tab",
        tab,
      ]);
      if (next !== clockBefore) break;
      if (i === 19)
        throw Error(
          `Playback clock did not advance: ${clockBefore}; ${await cli(["text", "--selector", "#error", "--full", "--tab", tab])}; ${await cli(["errors", "--tab", tab])}`,
        );
    }
    await clickNamedButton("Pause");
    const stopped = await cli([
      "text",
      "--selector",
      "#clock",
      "--full",
      "--tab",
      tab,
    ]);
    await Bun.sleep(350);
    if (
      stopped !==
      (await cli(["text", "--selector", "#clock", "--full", "--tab", tab]))
    )
      throw Error("Pause did not stop playback");
    const snapshot = JSON.parse(await cli(["snap", "--json", "--tab", tab]));
    const seek = snapshot.nodes.find(
      (n) => n.role === "slider" && n.name === "Replay time",
    );
    if (!seek) throw Error("Replay seek control absent");
    await cli(["press", seek.ref, "Home", "--tab", tab]);
    await untilText("#clock", "00:00 / 02:00");
    await cli(["press", seek.ref, "End", "--tab", tab]);
    await untilText("#clock", "02:00 / 02:00");
    await cli([
      "screenshot",
      "--tab",
      tab,
      "-o",
      resolve(outputPath),
      "--beyond-viewport",
    ]);
    await clickNamedButton("Ornn skin 0");
    await untilText("#camera-status", "Following Ornn");
    await cli([
      "screenshot",
      "--tab",
      tab,
      "-o",
      resolve(outputPath).replace(/\.png$/, "-follow.png"),
      "--beyond-viewport",
    ]);
    const errors = await cli(["errors", "--tab", tab]);
    if (errors.trim() !== "No errors") throw Error(errors);
    console.log(
      JSON.stringify({
        browser: "Chrome via PinchTab",
        origin: preview.origin,
        mode,
        champions: 10,
        championMovementRecords: 2343,
        recordedMotionJump: true,
        playbackAdvanced: true,
        pauseStopped: true,
        seekStartAndEnd: true,
        followCamera: true,
        recordedAnimationJump: true,
        recordedAttackJump: true,
        pageErrors: 0,
        screenshot: resolve(outputPath),
      }),
    );
  } else {
    await clickNamedButton("Run browser comparison");
    await untilText("#status", "Comparison finished");
    const comparison = {};
    for (const name of ["matched", "unresolved", "mismatches"]) {
      const text = await cli([
        "text",
        "--selector",
        `#${name}`,
        "--full",
        "--tab",
        tab,
      ]);
      // PinchTab's selector text endpoint returns the selected scalar directly.
      if (!/^\s*\d+\s*$/.test(text))
        throw Error(`Invalid browser count: ${name}`);
      comparison[name] = Number(text.trim());
    }
    // These are acceptance values for the documented local research corpus.
    if (
      comparison.matched !== 4927 ||
      comparison.unresolved !== 0 ||
      comparison.mismatches !== 0
    )
      throw Error("Unexpected corpus comparison counts");
    await clickNamedButton("Decode original ROFL");
    const reconstruction = await untilText(
      "#reconstruction-status",
      "ROFL decoded:",
    );
    if (
      !reconstruction.includes("10 champions") ||
      !reconstruction.includes("2,343 champion path records")
    )
      throw Error("Unexpected reconstruction counts");
    const errors = await cli(["errors", "--tab", tab]);
    if (errors.trim() !== "No errors") throw Error(errors);
    await cli([
      "screenshot",
      "--tab",
      tab,
      "-o",
      resolve(outputPath),
      "--beyond-viewport",
    ]);
    console.log(
      JSON.stringify({
        browser: "Chrome via PinchTab",
        origin: preview.origin,
        matchedSamples: 4927,
        unresolved: 0,
        mismatches: 0,
        champions: 10,
        championMovementRecords: 2343,
        endTime: 120,
        pageErrors: 0,
        screenshot: resolve(outputPath),
      }),
    );
  }
} finally {
  // This exact live handle owns both the bridge and its isolated Chrome child.
  if (bridge.exitCode === null) {
    const stop = Bun.spawn(
      [
        "C:/Windows/System32/taskkill.exe",
        "/PID",
        String(bridge.pid),
        "/T",
        "/F",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    await stop.exited;
  }
  await Promise.allSettled(drains);
}
