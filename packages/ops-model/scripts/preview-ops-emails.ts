import { mkdir } from "node:fs/promises";
import path from "node:path";
import { extractSenderDisplayName } from "@shepherdjerred/ops-model/email/mailbox.ts";
import { escapeHtml } from "@shepherdjerred/ops-model/email/primitives.ts";
import { renderEmailHtml } from "@shepherdjerred/ops-model/email/render-html.ts";
import { renderEmailText } from "@shepherdjerred/ops-model/email/render-text.ts";
import { buildPreviewScenarios } from "./preview-ops-fixtures.ts";

const OUT_DIR = "/tmp/ops-email-preview-gallery";

await mkdir(OUT_DIR, { recursive: true });
const scenarios = buildPreviewScenarios();

type ScenarioBundle = {
  id: string;
  category: string;
  label: string;
  senderName: string;
  from: string;
  to: string;
  subject: string;
  preheader: string;
  legacyFrom: string;
  legacyTo: string;
  legacySubject: string;
  legacyHtml: string;
  text: string;
  lightHtml: string;
  darkHtml: string;
};

const bundles: ScenarioBundle[] = [];

for (const scenario of scenarios) {
  const lightHtml = renderEmailHtml(scenario.document, {
    forceColorScheme: "light",
  });
  const darkHtml = renderEmailHtml(scenario.document, {
    forceColorScheme: "dark",
  });
  const text = renderEmailText(scenario.document);
  await Promise.all([
    Bun.write(path.join(OUT_DIR, `${scenario.id}-light.html`), lightHtml),
    Bun.write(path.join(OUT_DIR, `${scenario.id}-dark.html`), darkHtml),
    Bun.write(path.join(OUT_DIR, `${scenario.id}.txt`), text),
  ]);
  bundles.push({
    id: scenario.id,
    category: scenario.category,
    label: scenario.label,
    senderName: extractSenderDisplayName(scenario.from),
    from: scenario.from,
    to: scenario.to,
    subject: scenario.subject,
    preheader: scenario.document.preheader,
    legacyFrom: scenario.legacyFrom,
    legacyTo: scenario.legacyTo,
    legacySubject: scenario.legacySubject,
    legacyHtml: scenario.legacyHtml,
    text,
    lightHtml,
    darkHtml,
  });
}

const inboxRowsHtml = bundles
  .map(
    (b, idx) => `
    <button type="button" class="inbox-row${idx === 0 ? " active" : ""}" data-scenario="${escapeHtml(b.id)}">
      <span class="inbox-sender">${escapeHtml(b.senderName)}</span>
      <span class="inbox-to">${escapeHtml(b.to)}</span>
      <span class="inbox-line">
        <strong>${escapeHtml(b.subject)}</strong>
        <span class="inbox-pre"> &mdash; ${escapeHtml(b.preheader)}</span>
      </span>
    </button>`,
  )
  .join("");

const serializedBundles = JSON.stringify(bundles).replaceAll(
  "</",
  String.raw`<\/`,
);

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Ops Email Redesign &mdash; Hub Editorial Plain-English Preview</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0f1311;
      --panel: #171b19;
      --panel-2: #202623;
      --ink: #edf2ee;
      --muted: #9eaaa3;
      --line: #2d3531;
      --accent: #4cc393;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); }
    header {
      position: sticky; top: 0; z-index: 20;
      background: rgba(15, 19, 17, 0.94); backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--line); padding: 14px 22px;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px;
    }
    h1 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
    .sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
    .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .seg {
      display: inline-flex; background: var(--panel); border: 1px solid var(--line);
      border-radius: 8px; padding: 2px; gap: 2px;
    }
    .seg button {
      appearance: none; border: 0; background: transparent; color: var(--muted);
      padding: 6px 11px; border-radius: 6px; font-size: 12.5px; font-weight: 600; cursor: pointer;
    }
    .seg button.active { background: var(--panel-2); color: var(--ink); }
    main { max-width: 1440px; margin: 0 auto; padding: 18px 22px 48px; }
    .inbox-box {
      background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
      overflow: hidden; margin-bottom: 16px;
    }
    .inbox-head {
      padding: 9px 14px; border-bottom: 1px solid var(--line);
      display: flex; justify-content: space-between; align-items: center;
      font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted);
    }
    .inbox-row {
      width: 100%; display: grid; grid-template-columns: 165px 135px 1fr; gap: 12px;
      align-items: baseline; text-align: left; padding: 10px 14px;
      background: transparent; border: 0; border-bottom: 1px solid var(--line);
      color: var(--ink); font-size: 13.5px; cursor: pointer;
    }
    .inbox-row:last-child { border-bottom: 0; }
    .inbox-row.active { background: rgba(76, 195, 147, 0.12); border-left: 3px solid var(--accent); padding-left: 11px; }
    .inbox-sender { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .inbox-to { font-family: "Berkeley Mono", ui-monospace, monospace; font-size: 11.5px; color: var(--accent); }
    .inbox-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .inbox-pre { color: var(--muted); font-weight: 400; }
    .grid {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start;
    }
    .grid.mobile iframe { max-width: 375px; margin: 0 auto; }
    .col {
      background: var(--panel); border: 1px solid var(--line); border-radius: 11px; overflow: hidden;
    }
    .col-head { padding: 12px 15px; border-bottom: 1px solid var(--line); font-size: 12.5px; line-height: 1.5; }
    .col-code { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .col-head code { font-family: "Berkeley Mono", ui-monospace, monospace; font-size: 12px; }
    .frame-wrap { padding: 12px; background: #0a0d0b; display: flex; justify-content: center; }
    iframe {
      width: 100%; height: 760px; border: 1px solid var(--line); border-radius: 8px; background: #fff;
    }
    pre.plain-box {
      display: none; background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
      padding: 18px; font-family: "Berkeley Mono", ui-monospace, monospace; font-size: 12.5px;
      line-height: 1.6; white-space: pre-wrap; color: var(--ink);
    }
    body[data-mode="plain"] .grid { display: none; }
    body[data-mode="plain"] pre.plain-box { display: block; }
  </style>
</head>
<body data-mode="html">
  <header>
    <div>
      <h1>Ops Email Redesign &mdash; Before vs. Hub Editorial (Plain English v2)</h1>
      <div class="sub">Action-first hierarchy, everyday English subjects &amp; headlines, quiet Technical Details table</div>
    </div>
    <div class="controls">
      <div class="seg" role="group" aria-label="Right column mode">
        <button type="button" data-right="legacy" class="active">Before vs. Light</button>
        <button type="button" data-right="dark">Light vs. Dark</button>
      </div>
      <div class="seg" role="group" aria-label="Viewport">
        <button type="button" data-vp="desktop" class="active">Desktop (620px)</button>
        <button type="button" data-vp="mobile">Mobile (375px)</button>
      </div>
      <div class="seg" role="group" aria-label="Format">
        <button type="button" data-fmt="html" class="active">HTML</button>
        <button type="button" data-fmt="plain">Plain Text</button>
      </div>
    </div>
  </header>
  <main>
    <section class="inbox-box" aria-label="Simulated Inbox List View">
      <div class="inbox-head">
        <span>Inbox List View (Click any email)</span>
        <span>Wildcard @sjer.red Routing</span>
      </div>
      ${inboxRowsHtml}
    </section>

    <section class="grid" id="preview-grid">
      <div class="col" id="left-col">
        <div class="col-head" id="left-head"></div>
        <div class="frame-wrap"><iframe title="Left comparison preview" id="frame-left"></iframe></div>
      </div>
      <div class="col" id="right-col">
        <div class="col-head" id="right-head"></div>
        <div class="frame-wrap"><iframe title="Right comparison preview" id="frame-right"></iframe></div>
      </div>
    </section>

    <pre class="plain-box" id="plain-view"></pre>
  </main>

  <script>
    const SCENARIOS = ${serializedBundles};
    let activeId = SCENARIOS[0].id;
    let mode = "legacy";

    function setHead(el, tag, color, from, to, subject) {
      el.innerHTML =
        '<div class="col-code" style="color:' + color + ';">' + tag + '</div>' +
        '<div><strong>From:</strong> <code></code> &middot; <strong>To:</strong> <code></code></div>' +
        '<div><strong>Subject:</strong> <code></code></div>';
      const codes = el.querySelectorAll("code");
      codes[0].textContent = from;
      codes[1].textContent = to;
      codes[2].textContent = subject;
    }

    function render() {
      const item = SCENARIOS.find((s) => s.id === activeId) || SCENARIOS[0];
      document.querySelectorAll(".inbox-row").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.scenario === item.id);
      });
      if (mode === "legacy") {
        setHead(document.getElementById("left-head"), "Before (Legacy Repo Output)", "#f06a63", item.legacyFrom, item.legacyTo, item.legacySubject);
        setHead(document.getElementById("right-head"), "After — Hub Editorial (Plain English v2)", "#4cc393", item.from, item.to, item.subject);
        document.getElementById("frame-left").srcdoc = item.legacyHtml;
        document.getElementById("frame-right").srcdoc = item.lightHtml;
      } else {
        setHead(document.getElementById("left-head"), "Hub Editorial — Light Mode", "#4cc393", item.from, item.to, item.subject);
        setHead(document.getElementById("right-head"), "Hub Editorial — Dark Mode", "#4cc393", item.from, item.to, item.subject);
        document.getElementById("frame-left").srcdoc = item.lightHtml;
        document.getElementById("frame-right").srcdoc = item.darkHtml;
      }
      const nl = String.fromCodePoint(10);
      document.getElementById("plain-view").textContent =
        ["From: " + item.from, "To: " + item.to, "Subject: " + item.subject, "", item.text].join(nl);
    }

    document.querySelectorAll(".inbox-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeId = btn.dataset.scenario;
        render();
      });
    });
    document.querySelectorAll("[data-right]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.right;
        document.querySelectorAll("[data-right]").forEach((b) => b.classList.toggle("active", b === btn));
        render();
      });
    });
    document.querySelectorAll("[data-vp]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mobile = btn.dataset.vp === "mobile";
        document.querySelectorAll("[data-vp]").forEach((b) => b.classList.toggle("active", b === btn));
        document.getElementById("preview-grid").classList.toggle("mobile", mobile);
      });
    });
    document.querySelectorAll("[data-fmt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.body.dataset.mode = btn.dataset.fmt;
        document.querySelectorAll("[data-fmt]").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
    render();
  </script>
</body>
</html>`;

await Bun.write(path.join(OUT_DIR, "index.html"), indexHtml);
console.warn(
  JSON.stringify({
    level: "info",
    message: "Rendered Hub Editorial v2 ops email workbench",
    scenarios: bundles.length,
    indexPath: path.join(OUT_DIR, "index.html"),
  }),
);
