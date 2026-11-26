// Agents in status, priority, recent, space, machine, agent, or name views;
// parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  agents,
  terminals,
  panes,
  focused,
  spaces,
  run,
  theme,
  shared,
  setShared,
  setAgentOrder,
  openOverlay,
  closeOverlay,
  props,
  window,
  layout,
  nextCommand,
  checking,
  exec,
  hc,
} from "herdr";

// Agents whose provider is at a usage limit (Brim) are hidden until "hide.exhausted"
// is set to false (shared with my-spaces). This copy polls Brim into "brim.exhausted":
// provider -> { reason, resetsIn }. Unknown, stale or missing quota hides nothing.
const hidingExhausted = () => shared("hide.exhausted") !== false;
const limits = () => shared("brim.exhausted") ?? {};
// Brim's provider ids, by the app an agent reports or its program's key.
const PROVIDER = {
  "claude-code": "claude-code",
  claude: "claude-code",
  codex: "codex",
  antigravity: "antigravity",
  agy: "antigravity",
  gemini: "antigravity",
  cursor: "cursor",
  "cursor-agent": "cursor",
  grok: "grok",
  "grok-build": "grok",
  kimi: "kimi",
  muse: "muse",
};
const PROVIDER_LABELS = {
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  cursor: "Cursor",
  grok: "Grok",
  kimi: "Kimi Code",
  muse: "Meta Muse",
};
const atLimit = (a) =>
  Boolean(limits()[a.provider ?? PROVIDER[a.app] ?? PROVIDER[a.program?.key]]);
// The agent a terminal was started with, when the program table doesn't say (a Windows
// codex runs as powershell, and a macOS login-shell command wraps `brim --provider` or
// the agent binary). Never matches arbitrary words inside a script.
function fromArgv(argv) {
  const list = argv ?? [];
  const word = (a) => (a ?? "").replace(/^[&\s'"]+/, "").split(/['"\s]/)[0];
  const leaf = (w) =>
    w
      .split(/[\\/]/)
      .pop()
      .replace(/\.exe$/i, "")
      .toLowerCase();
  const head = list.includes("--") ? list.slice(0, list.indexOf("--")) : list;
  const brimAt = head.findIndex(
    (a, i) =>
      leaf(word(a)) === "brim" ||
      (leaf(word(a)) === "toolkit" && head[i + 1] === "brim"),
  );
  if (brimAt >= 0) {
    for (let i = brimAt + 1; i < head.length; i++) {
      if (head[i] === "--provider")
        return PROVIDER[(head[i + 1] ?? "").toLowerCase()];
      if (head[i]?.startsWith("--provider="))
        return PROVIDER[head[i].slice("--provider=".length).toLowerCase()];
    }
  }
  if (
    /^-[a-z]*c$/i.test(head[1] ?? "") &&
    head[4] &&
    leaf(word(head[3])) === leaf(word(head[0]))
  ) {
    const wrapped = PROVIDER[leaf(word(head[4]))];
    if (wrapped) return wrapped;
  }
  return list
    .map(word)
    .filter((w, i) => i === 0 || /[\\/]/.test(w))
    .map((w) => PROVIDER[leaf(w)])
    .find(Boolean);
}

// Live coding agents (by the program table, else their launch argv) that report no
// status, like `claude attach`, still get a row, with no status: shaped like agents()
// from their pane and tab.
function quiet(listed, all) {
  const byAddr = new Map(
    all.filter((k) => k.state === "live").map((k) => [k.address, k]),
  );
  const where = new Map(
    spaces().flatMap((s) =>
      (s.tabs ?? []).map((tab, i) => [tab.id, { s, tab, i }]),
    ),
  );
  return panes().flatMap((p) => {
    const w = where.get(p.tab);
    const term = p.terminal ? byAddr.get(p.terminal) : null;
    if (!p.terminal || p.status || listed.has(p.terminal) || !term || !w)
      return [];
    const provider = PROVIDER[p.program?.key] ?? fromArgv(term.argv ?? []);
    if (!provider) return [];
    return [
      {
        address: p.terminal,
        pane: p.pane,
        space: w.s.id,
        space_name: w.s.name,
        tab: w.tab.id,
        tab_index: w.i + 1,
        tab_name: w.tab.name,
        status: null,
        app: null,
        provider,
        program: p.program,
        title: p.title,
        seq: 0,
        focused: p.focused,
        pinned: Boolean(term.labels?.["herdr.pinned"]),
      },
    ];
  });
}

// Positive evidence only: a spent weekly/monthly budget, or a window Brim calls
// exhausted ("5-hour exhausted (95% used)"). Not "no usable usage window".
function spent(brim) {
  const out = {};
  for (const e of [...(brim.ranked ?? []), ...(brim.other ?? [])])
    if (e.budgetUsed >= 100)
      out[e.provider] = {
        reason: `${e.budgetKind ?? "budget"} ${Math.round(e.budgetUsed)}%`,
        resetsIn: e.budgetResetsIn ?? null,
      };
  for (const e of brim.unavailable ?? [])
    if (/^[\w-]+ exhausted/i.test(e.reason ?? ""))
      out[e.provider] = {
        reason: e.reason,
        resetsIn: e.budgetResetsIn ?? null,
      };
  return out;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", {
    id: "sidebar",
    px: narrow()
      ? (shared("sidebar.width") ?? 268)
      : window()?.platform === "macos"
        ? 76
        : 44,
  });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter((p) => p.tab === tab.id && p.terminal);
  return (
    mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0]
  );
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling =
    live &&
    live !== prog &&
    !/^[~/]|^[A-Za-z]:\\/.test(live) &&
    !live.includes("@") &&
    live.toLowerCase() !== l?.program?.key;
  return tab.name === prog && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  {
    id: "status",
    label: "Status",
    icon: "mods/workspace-chrome/circle-check.svg",
  },
  { id: "rank", label: "Priority", icon: "mods/my-agents/flag.svg" },
  { id: "recent", label: "Recent", icon: "mods/workspace-chrome/clock.svg" },
  { id: "grouped", label: "Space", icon: "mods/workspace-chrome/layers.svg" },
  { id: "machine", label: "Machine", icon: "mods/workspace-chrome/server.svg" },
  {
    id: "agent",
    label: "Coding agent",
    icon: "mods/workspace-chrome/terminal.svg",
  },
  { id: "name", label: "Name", icon: "mods/workspace-chrome/file-text.svg" },
];
const sortOf = () => {
  const raw = shared("agents.sort");
  if (!raw || raw === "priority") return SORTS[0];
  return SORTS.find((s) => s.id === raw) ?? SORTS[0];
};
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Which device an agent runs on: another machine by its SSH target (`hc machine ls`
// `target`, which stays put when Herdr renames a machine after its host), its name or
// its host; this computer by its platform. An unlisted machine shows its name.
const DEVICES = {
  "jerreds-macbook-pro": "laptop",
  macbook: "laptop",
  karpathy: "mac-mini-top",
  "mac-mini": "mac-mini-top",
  jobs: "mac-mini-top",
  "jerreds-mac-mini": "mac-mini-top",
  desktop: "windows",
  "jerred-desktop": "windows",
};
const DEVICE_TITLES = {
  "jerreds-macbook-pro": "MacBook",
  macbook: "MacBook",
  karpathy: "Karpathy",
  "mac-mini": "Karpathy",
  jobs: "Jobs",
  "jerreds-mac-mini": "Jobs",
  desktop: "Windows",
  "jerred-desktop": "Windows",
};
const MACHINE_ORDER = {
  MacBook: 1,
  Karpathy: 2,
  Windows: 3,
  Jobs: 4,
};

function hostKey(value) {
  if (value == null) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\.local$/, "");
}

// Machine name -> [target, host], refreshed with the machine list.
let machineAliases = {};
async function loadMachineAliases() {
  const r = await hc(["machine", "ls", "--json"]);
  if (r.code !== 0)
    throw new Error(r.stderr.trim() || `hc machine ls exited ${r.code}`);
  machineAliases = Object.fromEntries(
    JSON.parse(r.stdout).machines.map((m) => [m.name, [m.target, m.host]]),
  );
}
function device(machine) {
  if (!machine) return window()?.platform === "windows" ? "windows" : "laptop";
  const key = [machine, ...(machineAliases[machine] ?? [])]
    .map(hostKey)
    .find((k) => k in DEVICES);
  return key ? DEVICES[key] : null;
}
function deviceTitle(machine, localHost = "") {
  if (!machine) {
    const local = DEVICE_TITLES[hostKey(localHost)];
    if (local) return local;
    return window()?.platform === "windows" ? "Windows" : "This computer";
  }
  const key = [machine, ...(machineAliases[machine] ?? [])]
    .map(hostKey)
    .find((k) => k in DEVICE_TITLES);
  return key ? DEVICE_TITLES[key] : machine;
}
function machineRank(machine, localHost) {
  if (!machine) return 0;
  return MACHINE_ORDER[deviceTitle(machine, localHost)] ?? 99;
}

// A mark the person sets on a chat. "none" is only a filter/sort bucket.
const PRIORITIES = [
  { id: "p0", label: "P0", tone: "blocked" },
  { id: "p1", label: "P1", tone: "working" },
  { id: "p2", label: "P2", tone: "accent" },
  { id: "p3", label: "P3", tone: "foreground" },
  { id: "p4", label: "P4", tone: "muted" },
  { id: "later", label: "Later", tone: "dim" },
];
const PRIORITY_BUCKETS = [
  { id: "p0", label: "P0", tone: "blocked", order: 0 },
  { id: "p1", label: "P1", tone: "working", order: 1 },
  { id: "p2", label: "P2", tone: "accent", order: 2 },
  { id: "p3", label: "P3", tone: "foreground", order: 3 },
  { id: "p4", label: "P4", tone: "muted", order: 4 },
  { id: "none", label: "No priority", tone: "dim", order: 5 },
  { id: "later", label: "Later", tone: "dim", order: 6 },
];
const priorityMarks = () => {
  const marks = shared("agents.priorities");
  return marks && typeof marks === "object" ? marks : {};
};
const priorityOf = (address) => {
  const level = priorityMarks()[address];
  return PRIORITIES.some((p) => p.id === level) ? level : null;
};
const hiddenPriorities = () => {
  const raw = shared("agents.priorityHidden");
  const known = new Set([...PRIORITIES.map((p) => p.id), "none"]);
  return Array.isArray(raw) ? raw.filter((id) => known.has(id)) : [];
};
function writePriority(address, level) {
  const marks = { ...priorityMarks() };
  if (level) marks[address] = level;
  else delete marks[address];
  setShared("agents.priorities", marks);
}

function agentTypeName(a) {
  if (a.program?.name) return a.program.name;
  const prov = a.provider ?? PROVIDER[a.app] ?? PROVIDER[a.program?.key];
  if (prov && PROVIDER_LABELS[prov]) return PROVIDER_LABELS[prov];
  return a.app || "Agent";
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint
    ? svg(p.icon).size(size).flex_none().text_color(color)
    : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu || props()?.priorityMenu || props()?.filterMenu)
      return;
    this.folded = new Set();
    this.hostName = "";
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    if (checking()) return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("hostname", []);
        if (r.code === 0) {
          this.hostName = r.stdout.trim();
          if (shared("herdr.local-host") !== this.hostName)
            setShared("herdr.local-host", this.hostName);
          cx.notify();
        }
      } catch {}
    });
    cx.timer.every(30000, (cx) => cx.notify());
    cx.timer.every(60000, (cx) => this.pollBrim(cx));
    this.pollBrim(cx);
    // Machines can be renamed or added while the app runs; their icons follow.
    const aliases = (cx) =>
      cx.spawn(async (cx) => {
        await loadMachineAliases().catch(() => {});
        cx.notify();
      });
    cx.timer.every(60000, aliases);
    aliases(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const cmd = await nextCommand();
        if (cmd === "toggle-exhausted")
          setShared("hide.exhausted", !hidingExhausted());
        else if (cmd === "menu" || cmd === "migrate") {
          const f = focused();
          const a =
            agents().find((x) => x.address === f?.agent) ??
            agents().find((x) => x.focused) ??
            agents()[0];
          if (a) {
            if (cmd === "menu") this.agentMenu(a);
            else
              openOverlay({
                mod: "my-takeover",
                kind: "dialog",
                width: 560,
                height: 500,
                props: {
                  terminal: a.address,
                  pane: a.pane,
                  tab: a.tab,
                  space: a.space,
                  pickMachine: true,
                },
              });
          }
        }
        cx.notify();
      }
    });
  }

  // Published only when it changes; a failing brim hides nothing and shows nothing.
  // "brim.quotas": every provider in Brim's order, for my-status.
  pollBrim(cx) {
    cx.spawn(async () => {
      let next = {},
        quotas = [];
      try {
        const r = await exec("brim", ["--json"]);
        if (r.code === 0) {
          const brim = JSON.parse(r.stdout);
          next = spent(brim);
          quotas = [
            ...(brim.ranked ?? []),
            ...(brim.other ?? []),
            ...(brim.unavailable ?? []),
          ].map((e) => ({
            provider: e.provider,
            displayName: e.displayName,
            accountLabel: e.accountLabel ?? null,
            fiveHourUsed: e.fiveHourUsed ?? null,
            budgetUsed: e.budgetUsed ?? null,
            budgetKind: e.budgetKind ?? null,
            budgetResetsIn: e.budgetResetsIn ?? null,
            available: e.available,
            reason: e.reason ?? null,
            snapshotAge: e.snapshotAge ?? null,
          }));
        }
      } catch {}
      if (JSON.stringify(next) !== JSON.stringify(limits()))
        setShared("brim.exhausted", next);
      if (
        JSON.stringify(quotas) !== JSON.stringify(shared("brim.quotas") ?? [])
      )
        setShared("brim.quotas", quotas);
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed))
      if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Migrate legacy localStorage pins into Herdr's native terminal.pin label so both
  // this list and right-click context menus share the same pin state.
  migratePins(all) {
    if (!this.pendingPins.length) return;
    const listed = new Map(
      all.filter((k) => k.state === "live").map((k) => [k.address, k]),
    );
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  isPinned(a) {
    return Boolean(a.pinned || this.pendingPins.includes(a.address));
  }

  // Drops marks for chats that ended. A machine the list has not heard from yet keeps its marks.
  prunePriorities(all) {
    const marks = priorityMarks();
    const machine = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
    const heard = new Set(all.map((k) => machine(k.address)));
    const live = new Set(
      all.filter((k) => k.state === "live").map((k) => k.address),
    );
    const next = {};
    let dirty = false;
    for (const [addr, level] of Object.entries(marks)) {
      if (!PRIORITIES.some((p) => p.id === level)) {
        dirty = true;
        continue;
      }
      if (heard.has(machine(addr)) && !live.has(addr)) {
        dirty = true;
        continue;
      }
      next[addr] = level;
    }
    if (dirty) setShared("agents.priorities", next);
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle")
      this.held = cur
        ? { address: cur.address, rank: RANK[cur.status] ?? 0 }
        : null;
  }

  rank(a) {
    const sawDone =
      a.address === this.held?.address &&
      this.held.rank === RANK.done &&
      a.status === "idle";
    return sawDone ? RANK.done : (RANK[a.status] ?? 0);
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(
        div()
          .px(8)
          .pt(4)
          .pb(6)
          .text_size(11)
          .text_color(t.dim)
          .child("Sort agents"),
      )
      .children(
        SORTS.map((s) =>
          h_flex()
            .id(`sort-${s.id}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .text_color(t.foreground)
            .hover((el) => el.bg(t.hover))
            .on_click(() => {
              setShared("agents.sort", s.id);
              closeOverlay(props().overlay);
            })
            .child(svg(s.icon).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(s.label))
            .when(s.id === on, (el) =>
              el.child(
                svg("mods/workspace-chrome/check.svg")
                  .size(14)
                  .flex_none()
                  .text_color(t.foreground),
              ),
            ),
        ),
      );
  }

  // One choice. Picking the current mark clears it.
  priorityMenu(t) {
    const address = props().address;
    const current = priorityOf(address);
    const choices = [...PRIORITIES, { id: null, label: "None", tone: "muted" }];
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(
        div()
          .px(8)
          .pt(4)
          .pb(6)
          .text_size(11)
          .text_color(t.dim)
          .child("Priority"),
      )
      .children(
        choices.map((p) =>
          h_flex()
            .id(`pri-${p.id ?? "none"}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .text_color(t[p.tone] ?? t.foreground)
            .hover((el) => el.bg(t.hover))
            .on_click(() => {
              writePriority(address, current === p.id ? null : p.id);
              closeOverlay(props().overlay);
            })
            .child(div().flex_1().child(p.label))
            .when(current === p.id, (el) =>
              el.child(
                svg("mods/workspace-chrome/check.svg")
                  .size(14)
                  .flex_none()
                  .text_color(t.foreground),
              ),
            ),
        ),
      );
  }

  // A check means those chats stay listed. Toggling keeps the menu open.
  filterMenu(t) {
    const hidden = new Set(hiddenPriorities());
    const rows = [
      ...PRIORITIES,
      { id: "none", label: "No priority", tone: "muted" },
    ];
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(
        div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Show"),
      )
      .children(
        rows.map((p) => {
          const on = !hidden.has(p.id);
          return h_flex()
            .id(`filter-${p.id}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .text_color(on ? (t[p.tone] ?? t.foreground) : t.muted)
            .hover((el) => el.bg(t.hover))
            .on_click((_e, cx) => {
              const now = new Set(hiddenPriorities());
              if (on) now.add(p.id);
              else now.delete(p.id);
              setShared("agents.priorityHidden", [...now]);
              cx.notify();
            })
            .child(div().flex_1().child(p.label))
            .when(on, (el) =>
              el.child(
                svg("mods/workspace-chrome/check.svg")
                  .size(14)
                  .flex_none()
                  .text_color(t.foreground),
              ),
            );
        }),
      );
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  agentMenu(a) {
    this.hovered = null;
    openOverlay({
      mod: "my-menu",
      kind: "popup",
      width: 220,
      height: 390,
      props: {
        tab: "agent",
        target: {
          address: a.address,
          pane: a.pane,
          tab: a.tab,
          space: a.space,
        },
      },
    });
  }

  subAgentMenu(k) {
    openOverlay({
      mod: "my-menu",
      kind: "popup",
      width: 220,
      height: 250,
      props: {
        tab: "subagent",
        target: {
          address: k.address,
          hasPane: this.listed.has(k.address),
        },
      },
    });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    const hasPane = this.listed.has(k.address);
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(32)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() =>
        hasPane
          ? run("pane.focus", { terminal: k.address })
          : this.peek(k.address),
      )
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.subAgentMenu(k);
      })
      .children(
        s.lines.map((l) =>
          div()
            .self_start()
            .mt(-4)
            .w(9)
            .h(17)
            .mr(4)
            .flex_none()
            .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
            .when(l === "└" || l === "├", (el) =>
              el.border_b(1.5).rounded_bl(6),
            ),
        ),
      )
      .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(on ? t.foreground : t.muted)
          .child(
            k.labels?.["herdr.agent-name"] ||
              k.name ||
              k.template ||
              k.program?.name ||
              k.address,
          ),
      )
      .child(
        div()
          .w(16)
          .h(18)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .child(this.status(t, { address: k.address, status: st })),
      );
  }

  // Fixed-size status glyph so the status column never shifts width across rows.
  status(t, a) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working")
      return svg("mods/workspace-chrome/spinner.svg")
        .size(12)
        .flex_none()
        .text_color(t.working)
        .spin(900);
    if (a.status === "blocked") {
      const badge = div()
        .size(14)
        .flex_none()
        .rounded(4)
        .bg(t.blocked + "26")
        .text_size(10.5)
        .font_bold()
        .text_color(t.blocked)
        .flex()
        .items_center()
        .justify_center()
        .child("!");
      return a.address
        ? badge.id(`blocked-${a.address}`).tooltip("Needs you")
        : badge;
    }
    // Idle: a ring; done: a dot; no status reported: a faint ring.
    if (!a.status) {
      const ring = div()
        .size(7)
        .rounded(4)
        .border(1.5)
        .border_color(t.dim + "80");
      return a.address
        ? div()
            .id(`quiet-${a.address}`)
            .flex_none()
            .p(2)
            .tooltip("No status: this program doesn't report one")
            .child(ring)
        : ring;
    }
    if (a.status === "idle")
      return div()
        .size(7)
        .flex_none()
        .rounded(4)
        .border(1.5)
        .border_color(t.idle ?? t.dim);
    return div()
      .size(7)
      .flex_none()
      .rounded(4)
      .bg(a.status === "done" ? color : t.dim + "00");
  }

  render() {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.priorityMenu) return this.priorityMenu(t);
    if (props()?.filterMenu) return this.filterMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    const all = terminals();
    this.migratePins(all);
    let list = agents();
    list = [...list, ...quiet(new Set(list.map((a) => a.address)), all)];
    const hidden = hidingExhausted() ? list.filter(atLimit).length : 0;
    if (hidden) list = list.filter((a) => !atLimit(a));
    const hiding = hidingExhausted();
    const names = Object.keys(limits());
    const why = Object.entries(limits())
      .map(
        ([p, l]) =>
          `${p}: ${l.reason}${l.resetsIn ? `, resets in ${l.resetsIn}` : ""}`,
      )
      .join("\n");
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    this.prunePriorities(all);
    const hiddenPri = hiddenPriorities();
    const hadAgents = list.length > 0;
    const matched = hiddenPri.length
      ? list.filter((a) => !hiddenPri.includes(priorityOf(a.address) ?? "none"))
      : list;
    list = matched;

    // Compute row labels/details before sorting so Name sort matches displayed text.
    const tabs = spaces().flatMap((s) => s.tabs);
    const allPanes = panes();
    const namedAgents = new Map(
      all.map((term) => [term.address, term.labels?.["herdr.agent-name"]]),
    );
    const label = (a) => {
      const name = namedAgents.get(a.address);
      if (name) return name;
      const tab = tabs.find((tab) => tab.id === a.tab);
      return tab
        ? title(tab, lead(tab, allPanes))
        : a.title || a.program?.name || "";
    };
    const detail = new Map(
      list.map((a) => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]),
    );
    const seen = {};
    for (const a of list) {
      const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`;
      seen[k] = (seen[k] ?? 0) + 1;
    }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1)
        detail.set(a.address, label(a));
    }

    const urgency = new Map(
      list.map((a) => [
        a.address,
        Math.max(
          this.rank(a),
          ...this.tree(all, a.address).map(
            (s) => RANK[kidStatus(s.t, this.listed)] ?? 0,
          ),
        ),
      ]),
    );
    const rankOf = (a) => urgency.get(a.address) ?? 0;
    const byUrgency = (x, y) =>
      rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq;
    const machineOf = (a) =>
      a.address.includes("/") ? a.address.split("/")[0] : null;
    const bucketOf = (a) => {
      const id = priorityOf(a.address) ?? "none";
      return (
        PRIORITY_BUCKETS.find((b) => b.id === id) ??
        PRIORITY_BUCKETS.find((b) => b.id === "none")
      );
    };
    const displayKey = (a) =>
      `${a.space_name || label(a)} ${detail.get(a.address) ?? ""}`
        .trim()
        .toLowerCase();

    const pinned = list.filter((a) => this.isPinned(a));
    let rest = list.filter((a) => !this.isPinned(a));

    if (sort.id === "status") {
      rest = [...rest].sort(byUrgency);
    } else if (sort.id === "rank") {
      rest = [...rest].sort(
        (x, y) => bucketOf(x).order - bucketOf(y).order || byUrgency(x, y),
      );
    } else if (sort.id === "recent") {
      rest = [...rest].sort(
        (x, y) =>
          this.since(y) - this.since(x) ||
          rankOf(y) - rankOf(x) ||
          y.seq - x.seq,
      );
    } else if (sort.id === "machine") {
      rest = [...rest].sort((x, y) => {
        const mx = machineOf(x);
        const my = machineOf(y);
        return (
          machineRank(mx, this.hostName) - machineRank(my, this.hostName) ||
          deviceTitle(mx, this.hostName).localeCompare(
            deviceTitle(my, this.hostName),
          ) ||
          byUrgency(x, y)
        );
      });
    } else if (sort.id === "agent") {
      rest = [...rest].sort(
        (x, y) =>
          agentTypeName(x).localeCompare(agentTypeName(y)) || byUrgency(x, y),
      );
    } else if (sort.id === "name") {
      rest = [...rest].sort(
        (x, y) =>
          displayKey(x).localeCompare(displayKey(y), undefined, {
            numeric: true,
            sensitivity: "base",
          }) || byUrgency(x, y),
      );
    }

    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce(
        (m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m),
        null,
      );
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex_none()
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(
          svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`)
            .size(11)
            .flex_none(),
        )
        .when(!open, (el) => el.child(String(subs.length)));
    };

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      const machine = machineOf(a);
      const host = device(machine);
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            this.agentMenu(a);
          })
          .child(
            div()
              .flex_1()
              .min_w(0)
              .whitespace_nowrap()
              .text_right()
              .text_color(t.muted)
              .child(String(i + 1)),
          )
          .child(
            h_flex()
              .w(14)
              .flex_none()
              .items_center()
              .justify_center()
              .child(this.status(t, a)),
          );
      }
      const when = this.since(a);
      const idle = (a.status === "idle" || !a.status) && !a.focused;
      const pri = PRIORITIES.find((p) => p.id === priorityOf(a.address));
      const pinnedRow = this.isPinned(a);
      const hovered = this.hovered === a.address;
      const limited = atLimit(a);
      const takeover = div()
        .id(`takeover-${a.address}`)
        .size(20)
        .flex_none()
        .rounded(4)
        .text_color(limited ? t.working : t.dim)
        .cursor_pointer()
        .flex()
        .items_center()
        .justify_center()
        .hover((s) =>
          s.bg(t.hover).text_color(limited ? t.blocked : t.foreground),
        )
        .tooltip(
          limited
            ? "Provider at limit — take over with another agent"
            : "Take over with another agent",
        )
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.hovered = null;
          openOverlay({
            mod: "my-takeover",
            kind: "dialog",
            width: 560,
            height: 500,
            props: {
              terminal: a.address,
              pane: a.pane,
              tab: a.tab,
              space: a.space,
            },
          });
        })
        .child(svg("mods/my-takeover/takeover.svg").size(13));
      const pin = div()
        .id(`pin-${a.address}`)
        .size(20)
        .flex_none()
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .flex()
        .items_center()
        .justify_center()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(pinnedRow ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !pinnedRow });
          if (pinnedRow && this.pendingPins.includes(a.address)) {
            this.pendingPins = this.pendingPins.filter((p) => p !== a.address);
            if (this.pendingPins.length)
              localStorage.setItem("pins", JSON.stringify(this.pendingPins));
            else localStorage.removeItem("pins");
          }
          this.hovered = null;
          cx.notify();
        })
        .child(
          svg(
            `mods/workspace-chrome/${pinnedRow ? "pin-off" : "pin"}.svg`,
          ).size(13),
        );
      // Under a space header the space goes without saying; in all other views, include space.
      const full = sort.id !== "grouped" || pinnedRow;
      const name = full
        ? a.space_name || label(a)
        : (more ??
          (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a)));
      const hasDetail = full && Boolean(more);
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(7)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.agentMenu(a);
        })
        .child(
          div()
            .id(`agent-fold-${a.address}`)
            .w(16)
            .h(16)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .when(subs.length > 0, (el) =>
              el.on_click((_e, cx) => {
                cx.stop_propagation();
                this.folded.has(a.address)
                  ? this.folded.delete(a.address)
                  : this.folded.add(a.address);
                cx.notify();
              }),
            )
            .when(Boolean(pic), (el) => el.child(pic)),
        )
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .gap(5)
            .items_center()
            .when(hasDetail, (el) =>
              el
                .child(
                  div()
                    .flex_none()
                    .max_w(98)
                    .truncate()
                    .text_color(idle ? t.muted : t.foreground)
                    .child(name),
                )
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .text_color(t.dim)
                    .child(`\u00b7 ${more}`),
                ),
            )
            .when(!hasDetail, (el) =>
              el.child(
                div()
                  .flex_1()
                  .min_w(0)
                  .truncate()
                  .text_color(idle ? t.muted : t.foreground)
                  .child(name),
              ),
            )
            .when(subs.length > 0, (el) => el.child(fold(a, subs))),
        )
        .child(
          h_flex()
            .flex_none()
            .items_center()
            .gap(4)
            .when(limited || hovered, (el) => el.child(takeover))
            .child(
              div()
                .w(28)
                .h(18)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .when(Boolean(pri) || hovered, (el) =>
                  el.child(
                    div()
                      .id(`pri-${a.address}`)
                      .px(3)
                      .rounded(4)
                      .text_size(pri?.id === "later" ? 9.5 : 10)
                      .font_semibold()
                      .whitespace_nowrap()
                      .text_color(pri ? (t[pri.tone] ?? t.foreground) : t.dim)
                      .cursor_pointer()
                      .tooltip(pri ? `Priority ${pri.label}` : "Set priority")
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => {
                        cx.stop_propagation();
                        openOverlay({
                          mod: "my-agents",
                          kind: "popup",
                          width: 160,
                          height: 64 + (PRIORITIES.length + 1) * 31,
                          props: { priorityMenu: true, address: a.address },
                        });
                      })
                      .child(pri ? pri.label : "P"),
                  ),
                ),
            )
            .child(
              div()
                .id(`host-${a.address}`)
                .w(16)
                .h(18)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .tooltip(deviceTitle(machine, this.hostName))
                .child(
                  svg(
                    host
                      ? `mods/my-agents/${host}.svg`
                      : "mods/workspace-chrome/server.svg",
                  )
                    .size(12)
                    .flex_none()
                    .text_color(t.dim),
                ),
            )
            .child(
              div()
                .w(26)
                .h(18)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .when(hovered, (el) => el.child(pin))
                .when(!hovered && Boolean(when), (el) =>
                  el.child(
                    div()
                      .text_size(11)
                      .text_color(t.dim)
                      .whitespace_nowrap()
                      .child(duration(now - when)),
                  ),
                ),
            )
            .child(
              div()
                .w(16)
                .h(18)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .child(this.status(t, a)),
            ),
        );
    };

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown))];
    };

    // Groups in list order according to the active sort mode.
    const groups = pinned.length
      ? [
          {
            id: "pinned",
            label: "Pinned",
            tone: null,
            showCount: true,
            members: pinned,
          },
        ]
      : [];
    const pushGroup = (id, labelText, tone, showCount, member) => {
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(member);
      else
        groups.push({
          id,
          label: labelText,
          tone,
          showCount,
          members: [member],
        });
    };
    for (const a of rest) {
      if (sort.id === "status") {
        const r = rankOf(a) || RANK.idle;
        pushGroup(`sec-${r}`, SECTION[r], SECTION_STATUS[r], true, a);
      } else if (sort.id === "rank") {
        const b = bucketOf(a);
        pushGroup(`pri-${b.id}`, b.label, b.tone, true, a);
      } else if (sort.id === "recent") {
        pushGroup("recent", "Recent", null, true, a);
      } else if (sort.id === "grouped") {
        pushGroup(`sp-${a.space}`, a.space_name || "", null, false, a);
      } else if (sort.id === "machine") {
        const m = machineOf(a);
        pushGroup(
          `mc-${m ?? "local"}`,
          deviceTitle(m, this.hostName),
          null,
          true,
          a,
        );
      } else if (sort.id === "agent") {
        const kind = agentTypeName(a);
        pushGroup(`agp-${kind}`, kind, null, true, a);
      } else {
        pushGroup("alpha", "By name", null, true, a);
      }
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce(
        (m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m),
        null,
      );
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(
          div()
            .truncate()
            .text_color((g.tone && t[g.tone]) || t.dim)
            .child(g.label),
        )
        .when(g.showCount || !open, (el) =>
          el.child(div().text_color(t.dim).child(String(g.members.length))),
        )
        .child(div().flex_1())
        .when(!open, (el) =>
          el
            .when(sort.id !== "status" && top && top !== "idle", (el) =>
              el.child(this.status(t, { status: top })),
            )
            .child(
              svg("mods/workspace-chrome/chevron-right.svg")
                .size(11)
                .flex_none()
                .text_color(t.dim),
            ),
        );
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [
          header(g),
          ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids)),
        ]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(
              div()
                .text_size(11.5)
                .font_medium()
                .text_color(t.dim)
                .child("Agents"),
            )
            .child(
              h_flex()
                .gap(10)
                .items_center()
                .child(
                  div()
                    .id("ag-filter")
                    .text_size(11)
                    .text_color(hiddenPri.length ? t.foreground : t.dim)
                    .cursor_pointer()
                    .hover((s) => s.text_color(t.foreground))
                    .on_click(() =>
                      openOverlay({
                        mod: "my-agents",
                        kind: "popup",
                        width: 180,
                        height: 64 + (PRIORITIES.length + 1) * 31,
                        props: { filterMenu: true },
                      }),
                    )
                    .tooltip(
                      hiddenPri.length
                        ? `Showing ${
                            [
                              ...PRIORITIES.filter(
                                (p) => !hiddenPri.includes(p.id),
                              ).map((p) => p.label),
                              ...(hiddenPri.includes("none")
                                ? []
                                : ["No priority"]),
                            ].join(", ") || "nothing"
                          }`
                        : "Filter by priority",
                    )
                    .child(svg("mods/my-agents/funnel.svg").size(14)),
                )
                .child(
                  div()
                    .id("ag-sort")
                    .text_size(11)
                    .text_color(t.dim)
                    .cursor_pointer()
                    .hover((s) => s.text_color(t.foreground))
                    .on_click(() =>
                      openOverlay({
                        mod: "my-agents",
                        kind: "popup",
                        width: 205,
                        height: 54 + SORTS.length * 31,
                        props: { sortMenu: true },
                      }),
                    )
                    .tooltip(`Sort agents: ${sort.label}`)
                    .child(svg(sort.icon).size(14)),
                ),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(
          div()
            .px(12)
            .text_size(12)
            .text_color(t.dim)
            .child(
              hadAgents
                ? "Nothing matches this filter."
                : "No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.",
            ),
        ),
      )
      .child(
        v_flex()
          .id("ag-list")
          .flex_1()
          .min_h(0)
          .px(collapsed ? 0 : 8)
          .overflow_y_scrollbar()
          .mode("always")
          .children(rows),
      )
      .child(
        h_flex()
          .h(28)
          .px(12)
          .items_center()
          .justify_between()
          .when(collapsed, (el) => el.justify_center().px(0))
          .when(!collapsed && names.length > 0, (el) =>
            el.child(
              div()
                .id("limit-toggle")
                .min_w(0)
                .truncate()
                .text_size(11)
                .text_color(t.dim)
                .cursor_pointer()
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => setShared("hide.exhausted", !hiding))
                .tooltip(
                  hiding
                    ? `${why}\nClick to show them.`
                    : `Hide chats whose provider is at its limit:\n${why}`,
                )
                .child(
                  !hiding
                    ? "Hide chats at limit"
                    : `${hidden ? `${hidden} hidden · ` : ""}${names.join(", ")} at limit`,
                ),
            ),
          )
          .child(
            div()
              .id("collapse")
              .text_size(13)
              .text_color(t.dim)
              .hover((s) => s.text_color(t.foreground))
              .on_click(toggleSidebar)
              .child(collapsed ? "»" : ""),
          ),
      );
  }
}
