// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "agent" | "subagent" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// "worktree" opens my-worktree, "takeover"/"migrate" opens my-takeover, and "priority" opens an inline priority list.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, ScrollHandle } from "gpui-base";
import {
  run,
  props,
  closeOverlay,
  openOverlay,
  theme,
  keys,
  terminals,
  spaces,
  machines,
  panes,
  agents,
  shared,
  setShared,
  checking,
  exec,
  hc,
  home,
  notify,
  window,
} from "herdr";

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

function findAgentPane(tabId, all = terminals(), ps = panes()) {
  const argvOf = new Map(all.map((k) => [k.address, k.argv ?? []]));
  const inTab = ps.filter((pane) => pane.tab === tabId && pane.terminal);
  const isAgentPane = (pane) =>
    Boolean(
      pane.program?.agent || pane.status || fromArgv(argvOf.get(pane.terminal)),
    );
  return (
    inTab.find((pane) => pane.focused && isAgentPane(pane)) ??
    inTab.find(isAgentPane)
  );
}

const PRIORITIES = [
  { id: "p0", label: "P0", tone: "blocked" },
  { id: "p1", label: "P1", tone: "working" },
  { id: "p2", label: "P2", tone: "accent" },
  { id: "p3", label: "P3", tone: "foreground" },
  { id: "p4", label: "P4", tone: "muted" },
  { id: "later", label: "Later", tone: "dim" },
];

function priorityMarks() {
  const marks = shared("agents.priorities");
  return marks && typeof marks === "object" ? marks : {};
}

function priorityOf(address) {
  const level = priorityMarks()[address];
  return PRIORITIES.some((p) => p.id === level) ? level : null;
}

function writePriority(address, level) {
  const marks = { ...priorityMarks() };
  if (level) marks[address] = level;
  else delete marks[address];
  setShared("agents.priorities", marks);
}

function spaceCheckout(id) {
  const space = spaces().find((s) => s.id === id);
  if (!space) return null;
  const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
  const folder =
    panes().find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder;
  return (
    shared("worktree.checkouts")?.[
      JSON.stringify([space.machine ?? null, folder])
    ] ?? null
  );
}

function isPinned(address) {
  const ag = agents().find((a) => a.address === address);
  if (ag?.pinned != null) return Boolean(ag.pinned);
  const term = terminals().find((k) => k.address === address);
  return Boolean(term?.labels?.["herdr.pinned"]);
}

const canMigrate = () =>
  machines().length > 1 ||
  machines().some((m) => m.name !== null && m.layout !== "unavailable");

const takeoverItems = (targetProps) => [
  ["Take over…", "takeover", targetProps],
  ...(canMigrate()
    ? [["Move to machine…", "migrate", { ...targetProps, pickMachine: true }]]
    : []),
];

function agentName(term) {
  return (
    term?.labels?.["herdr.agent-name"] ||
    term?.name ||
    term?.template ||
    term?.program?.name ||
    term?.address
  );
}

function restartItems(address, all = terminals()) {
  if (!address || (!address.includes("/") && window()?.platform !== "macos"))
    return [];
  const term = all.find((k) => k.address === address);
  if (/^(?:[a-z]:[/\\]|\\\\)/i.test(term?.cwd ?? "")) return [];
  const provider =
    PROVIDER[term?.report?.app] ??
    PROVIDER[term?.program?.key] ??
    fromArgv(term?.argv);
  return term?.state === "live" && provider === "codex"
    ? [["Restart Codex session", "agent.restart", { address }]]
    : [];
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const ps = panes();
      const pane = ps.find((entry) => entry.pane === tg.pane);
      const inTab = Boolean(pane);
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      const isAgent = Boolean(
        inTab &&
        term &&
        (pane.program?.agent ||
          pane.status ||
          term.program?.agent ||
          term.status ||
          fromArgv(term.argv)),
      );
      return [
        ...(inTab
          ? [
              [
                "Split right",
                "pane.split",
                { direction: "right", pane: tg.pane },
              ],
              [
                "Split down",
                "pane.split",
                { direction: "down", pane: tg.pane },
              ],
              ["Zoom", "pane.zoom", { pane: tg.pane }],
            ]
          : []),
        ...(isAgent
          ? takeoverItems({ terminal: term.address, pane: tg.pane })
          : []),
        ...restartItems(tg.terminal, all),
        ...(term
          ? [
              toProgram
                ? [
                    "Use Herdr right-click menu",
                    "terminal.right_click",
                    { terminal: term.address, to: "menu" },
                  ]
                : [
                    "Send right-clicks to pane",
                    "terminal.right_click",
                    { terminal: term.address, to: "program" },
                  ],
            ]
          : []),
        ...(parent
          ? [
              [
                `Send back to ${parent.name || parent.address}`,
                "terminal.park",
                { terminal: term.address },
              ],
            ]
          : []),
        ...(inTab ? [["Close pane", "pane.close", { pane: tg.pane }]] : []),
      ];
    }
    case "tab": {
      const agentPane = findAgentPane(tg.id);
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ...(agentPane
          ? takeoverItems({
              terminal: agentPane.terminal,
              pane: agentPane.pane,
              tab: tg.id,
              space: tg.space,
            })
          : []),
        ["Close", "tab.close", { id: tg.id }],
      ];
    }
    case "space": {
      const all = terminals();
      const ps = panes();
      const spaceObj = spaces().find((s) => s.id === tg.id);
      const tabs = spaceObj?.tabs ?? [];
      const orderedTabs = [
        ...tabs.filter((c) => c.active),
        ...tabs.filter((c) => !c.active),
      ];
      let spaceAgent = null;
      for (const c of orderedTabs) {
        const found = findAgentPane(c.id, all, ps);
        if (found) {
          spaceAgent = { ...found, tab: c.id };
          break;
        }
      }
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git
          ? [
              ["New worktree", "worktree", { space: tg.id, action: "new" }],
              ["Open worktree", "worktree", { space: tg.id, action: "open" }],
            ]
          : []),
        ...(git === "linked"
          ? [
              [
                "Remove worktree",
                "worktree",
                { space: tg.id, action: "remove" },
              ],
            ]
          : []),
        ...(spaceAgent
          ? takeoverItems({
              terminal: spaceAgent.terminal,
              pane: spaceAgent.pane,
              tab: spaceAgent.tab,
              space: tg.id,
            })
          : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    }
    case "agent": {
      const pinned = isPinned(tg.address);
      const pri = PRIORITIES.find((k) => k.id === priorityOf(tg.address));
      const allPanes = panes();
      const tabPanes = tg.tab
        ? allPanes.filter((k) => k.tab === tg.tab).length
        : 0;
      const space = tg.space ? spaces().find((s) => s.id === tg.space) : null;
      const spaceTabs = space?.tabs?.length ?? 0;
      return [
        ...takeoverItems({
          terminal: tg.address,
          pane: tg.pane,
          tab: tg.tab,
          space: tg.space,
        }),
        ...restartItems(tg.address),
        ...(tg.tab
          ? [["Rename tab", "tab.rename", { id: tg.tab }]]
          : [["Rename agent", "agent.rename", { address: tg.address }]]),
        ...(tg.space
          ? [["Rename space", "space.rename", { id: tg.space }]]
          : []),
        pinned
          ? ["Unpin", "terminal.pin", { terminal: tg.address, pinned: false }]
          : [
              "Pin to top",
              "terminal.pin",
              { terminal: tg.address, pinned: true },
            ],
        [
          pri ? `Priority: ${pri.label}…` : "Set priority…",
          "priority",
          { address: tg.address },
        ],
        ...(git && tg.space
          ? [["New worktree", "worktree", { space: tg.space, action: "new" }]]
          : []),
        ...(git === "linked" && tg.space
          ? [
              [
                "Remove worktree",
                "worktree",
                { space: tg.space, action: "remove" },
              ],
            ]
          : []),
        ...(tabPanes > 1 && tg.pane
          ? [["Close pane", "pane.close", { pane: tg.pane }]]
          : []),
        ...(tg.tab
          ? [["Close tab", "tab.close", { id: tg.tab }]]
          : [["Close agent", "terminal.kill", { terminal: tg.address }]]),
        ...(spaceTabs > 1 && tg.space
          ? [["Close space", "space.close", { id: tg.space }]]
          : []),
      ];
    }
    case "subagent": {
      const pane = panes().find((p) => p.terminal === tg.address);
      const space = pane?.tab
        ? spaces().find((s) => s.tabs.some((tab) => tab.id === pane.tab))
        : null;
      return [
        ...(tg.hasPane
          ? [
              ["Focus pane", "pane.focus", { terminal: tg.address }],
              ...takeoverItems({ terminal: tg.address }),
              ["Park under parent", "terminal.park", { terminal: tg.address }],
            ]
          : [
              ["Peek", "terminal.peek", { terminal: tg.address }],
              ["Keep as tab", "terminal.keep", { terminal: tg.address }],
            ]),
        ...restartItems(tg.address),
        ...(pane?.tab
          ? [["Rename tab", "tab.rename", { id: pane.tab }]]
          : [["Rename agent", "agent.rename", { address: tg.address }]]),
        ...(space ? [["Rename space", "space.rename", { id: space.id }]] : []),
        ["Close agent", "terminal.kill", { terminal: tg.address }],
      ];
    }
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command, args) {
  if (command === "takeover") return "mods/my-takeover/takeover.svg";
  if (command === "migrate") return "mods/workspace-chrome/server.svg";
  if (command === "priority") return "mods/my-agents/flag.svg";
  if (command === "terminal.pin")
    return `mods/workspace-chrome/${args?.pinned === false ? "pin-off" : "pin"}.svg`;
  const name =
    command.endsWith(".close") || command === "terminal.kill"
      ? "x"
      : command.endsWith(".rename")
        ? "square-pen"
        : command.endsWith(".new") || command === "terminal.keep"
          ? "plus"
          : command === "worktree"
            ? "git-branch"
            : command === "app.help"
              ? "terminal"
              : command === "app.theme"
                ? "settings"
                : command === "pane.split"
                  ? "panel-right"
                  : command === "pane.zoom"
                    ? "square"
                    : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

const isCloseCmd = (cmd) => cmd.endsWith(".close") || cmd === "terminal.kill";
const separates = (list, i) =>
  i > 0 &&
  ((isCloseCmd(list[i][1]) && !isCloseCmd(list[i - 1][1])) ||
    list[i][1] === "app.help" ||
    (list[i][1] === "app.theme" && list[i - 1][1] !== "app.theme"));
const menuHeight = (p) =>
  p?.viewport ??
  { agent: 390, subagent: 250, space: 330, tab: 290 }[p?.tab] ??
  260;

function confirmClose(command, args, address, label) {
  const term = terminals().find((k) => k.address === address);
  if (term?.state !== "live") {
    notify({ title: "Agent already closed", level: "info" });
    return;
  }
  const all = spaces();
  const target =
    command === "space.close"
      ? all.find((s) => s.id === args.id)?.name
      : command === "tab.close"
        ? all.flatMap((s) => s.tabs).find((tab) => tab.id === args.id)?.name
        : agentName(term);
  const name = target || address;
  const detail =
    command === "space.close" || command === "tab.close"
      ? `This ends all terminals and their agents in “${name}”.`
      : `This ends “${name}” and its sub-agents.`;
  openOverlay({
    mod: "confirm",
    kind: "dialog",
    width: 420,
    height: 160,
    props: {
      title: `${label}?`,
      detail,
      command: {
        name: command,
        args:
          command === "space.close" || command === "tab.close"
            ? { ...args, confirmed: true }
            : args,
      },
    },
  });
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  if (name === "takeover") {
    const k = keys().find(
      (b) => b.section === "global" && b.action === "mod.open:my-takeover",
    );
    return k ? k.keys : "";
  }
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find(
    (b) =>
      b.section === "global" &&
      (b.action === name || b.action === `${name}:${value}`),
  );
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.sub = null;
    this.git = null;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.priorityScroll = ScrollHandle.new();
    this.action = null;
    this.busy = false;
    this.error = null;
    if (checking()) return;
    if (props()?.tab === "rename-agent") {
      this.input = InputState.new({ value: props().value });
      this.input.set_selected_range({ start: 0, end: props().value.length });
      this.input.on("submit", (_e, cx) => this.rename(cx));
      this.input.focus();
      return;
    }
    this.handle.focus();
    const p = props();
    if (p?.tab === "restart-agent" && p.immediate) {
      cx.spawn((cx) => this.restart(p, "wait", cx));
      return;
    }
    const spaceId =
      p?.tab === "space"
        ? p.target?.id
        : p?.tab === "agent"
          ? p.target?.space
          : null;
    // Keep the checkout actions stable until the next menu opens.
    this.git = spaceId ? spaceCheckout(spaceId) : null;
  }

  priorityChoices() {
    return [...PRIORITIES, { id: null, label: "None", tone: "muted" }];
  }

  choosePriority(i) {
    const address = props()?.target?.address;
    const pick = this.priorityChoices()[i];
    if (!address || !pick) return;
    const current = priorityOf(address);
    writePriority(address, current === pick.id ? null : pick.id);
    closeOverlay(props()?.overlay);
  }

  choose(it, cx) {
    const p = props();
    if (!it) return;
    if (it[1] === "priority") {
      const current = priorityOf(it[2].address);
      const idx = this.priorityChoices().findIndex((p) => p.id === current);
      this.sub = "priority";
      this.at = Math.max(0, idx);
      this.priorityScroll.scroll_to_item(this.at + 1);
      cx.notify();
      return;
    }
    closeOverlay(p?.overlay);
    if (isCloseCmd(it[1]) && (p?.tab === "agent" || p?.tab === "subagent"))
      confirmClose(it[1], it[2], p.target.address, it[0]);
    else if (it[1] === "agent.rename" || it[1] === "agent.restart") {
      const term = terminals().find((k) => k.address === it[2].address);
      if (term?.state !== "live") {
        notify({ title: "Agent already closed", level: "info" });
        return;
      }
      const rename = it[1] === "agent.rename";
      openOverlay({
        mod: "my-menu",
        kind: "dialog",
        modal: true,
        width: 430,
        height: rename ? 172 : 194,
        props: {
          tab: rename ? "rename-agent" : "restart-agent",
          address: term.address,
          value: agentName(term),
          immediate:
            !rename && (term.status === "idle" || term.status === "done"),
        },
      });
    } else if (it[1] === "worktree")
      openOverlay({
        mod: "my-worktree",
        kind: "dialog",
        ...(it[2].action === "open"
          ? { width: 560, height: 480 }
          : it[2].action === "new"
            ? { width: 640, height: 520 }
            : { width: 440, height: 260 }),
        props: it[2],
      });
    else if (it[1] === "takeover" || it[1] === "migrate")
      openOverlay({
        mod: "my-takeover",
        kind: "dialog",
        width: 560,
        height: 500,
        props: it[2],
      });
    else run(it[1], it[2]);
  }

  async rename(cx) {
    const p = props();
    if (this.busy || !this.input) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    try {
      const name = this.input.value().trim();
      if (name.length > 120) throw new Error("Use 120 characters or fewer.");
      const result = await hc(["label", p.address, `herdr.agent-name=${name}`]);
      if (result.code !== 0)
        throw new Error("Herdr could not rename this agent.");
      closeOverlay(p.overlay);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.busy = false;
      cx.notify();
    }
  }

  async restart(p, option, cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    try {
      const term = terminals().find((k) => k.address === p.address);
      if (term?.state !== "live") throw new Error("This session has closed.");
      if (
        option === "interrupt" &&
        (term.status !== "working" || term.turn !== this.interruptTurn)
      ) {
        this.action = null;
        throw new Error(
          "The active turn changed. Choose how to restart again.",
        );
      }
      const parts = p.address.split("/");
      const terminal = parts.pop();
      const on = parts[0] ?? null;
      let folder = home();
      if (on) {
        const result = await exec(
          "sh",
          ["-c", 'printf "%s\\n%s\\n" "$(uname -s)" "$HOME"'],
          { on },
        );
        const [platform, remoteHome] = result.stdout.trim().split("\n");
        if (result.code !== 0 || platform !== "Darwin" || !remoteHome) {
          throw new Error("Codex restart is available on macOS agent hosts.");
        }
        folder = remoteHome;
      } else if (window()?.platform !== "macos") {
        throw new Error("Codex restart is available on macOS agent hosts.");
      }
      const latest = terminals().find((k) => k.address === p.address);
      if (
        latest?.state !== "live" ||
        (option === "interrupt" && latest.turn !== this.interruptTurn)
      ) {
        this.action = null;
        throw new Error("This session changed. Open its menu to retry.");
      }
      const result = await exec(
        `${folder}/bin/restart-codex-panes`,
        [
          "--terminal",
          terminal,
          "--worker",
          ...(option === "interrupt"
            ? [
                "--interrupt-working",
                ...(Number.isSafeInteger(this.interruptTurn)
                  ? ["--expected-turn", String(this.interruptTurn)]
                  : []),
              ]
            : []),
          ...(option === "wait" ? ["--wait"] : []),
        ],
        { on, timeout: 90_000 },
      );
      const line = result.stdout
        .trim()
        .split("\n")
        .find((entry) =>
          /^(?:(restarted|skipped|failed):|Queued restart for )/.test(entry),
        );
      if (result.code !== 0 || /^(skipped|failed):/.test(line ?? "")) {
        const failure = line ?? result.stderr.trim().split("\n")[0];
        throw new Error(failure || "Codex could not restart this session.");
      }
      notify({
        title: "Codex restart",
        body: line ?? "Restart request accepted.",
        level: "success",
        action: { name: "agent.focus", args: { terminal: p.address } },
      });
      closeOverlay(p.overlay);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.busy = false;
      cx.notify();
    }
  }

  renderAgentAction(t, p) {
    const rename = p.tab === "rename-agent";
    const term = terminals().find((k) => k.address === p.address);
    const working = term?.status === "working";
    const interrupt = this.action === "confirm-interrupt" && working;
    const button = (id, label, tone, action) =>
      h_flex()
        .id(id)
        .h(32)
        .px(12)
        .items_center()
        .rounded(8)
        .bg(t.raised)
        .text_color(t[tone])
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => action(cx))
        .child(label);
    const confirm = (cx) => {
      if (this.busy || term?.state !== "live") return;
      if (rename) void this.rename(cx);
      else void this.restart(p, interrupt ? "interrupt" : "wait", cx);
    };
    const detail =
      this.error ??
      (this.busy
        ? rename
          ? "Saving…"
          : "Requesting restart…"
        : interrupt
          ? `Interrupt the current turn in “${p.value}” and resume the same conversation?`
          : working
            ? `“${p.value}” is working. You can wait for this turn to finish.`
            : `Resume “${p.value}” in the same terminal.`);
    return v_flex()
      .id("agent-action")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .rounded(8)
      .bg(t.popover)
      .text_size(13)
      .text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(p.overlay);
        else if (e.key === "enter" && !rename) confirm(cx);
        else return;
        cx.stop_propagation();
      })
      .child(
        div()
          .text_size(15)
          .font_semibold()
          .child(
            rename
              ? "Rename agent"
              : interrupt
                ? "Interrupt current turn?"
                : "Restart Codex session",
          ),
      )
      .when(rename && this.input, (el) =>
        el.child(
          Input.new(this.input)
            .h(36)
            .px(10)
            .rounded(9)
            .border_1()
            .border_color(t.input)
            .bg(t.background),
        ),
      )
      .when(!rename || this.error || this.busy, (el) =>
        el.child(
          div()
            .flex_1()
            .min_h(0)
            .overflow_y_scrollbar()
            .text_color(this.error ? t.blocked : t.muted)
            .child(detail),
        ),
      )
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .mt_auto()
          .child(
            button("action-cancel", "Cancel", "foreground", () =>
              closeOverlay(p.overlay),
            ),
          )
          .when(
            !this.busy &&
              working &&
              Number.isSafeInteger(term.turn) &&
              !rename &&
              !interrupt,
            (el) =>
              el.child(
                button("action-interrupt", "Interrupt…", "blocked", (cx) => {
                  this.interruptTurn = term.turn;
                  this.action = "confirm-interrupt";
                  cx.notify();
                }),
              ),
          )
          .when(!this.busy && term?.state === "live", (el) =>
            el.child(
              button(
                "action-confirm",
                rename
                  ? "Save"
                  : interrupt
                    ? "Interrupt and restart"
                    : working
                      ? "Wait until idle"
                      : "Restart",
                interrupt ? "blocked" : "accent",
                confirm,
              ),
            ),
          ),
      );
  }

  renderPriority(t) {
    const address = props()?.target?.address;
    const current = priorityOf(address);
    const choices = this.priorityChoices();
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .h(Math.min(menuHeight(props()), choices.length * 30 + 36))
      .min_h(0)
      .overflow_y_scrollbar()
      .track_scroll(this.priorityScroll)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % choices.length;
        else if (e.key === "up")
          this.at = (this.at + choices.length - 1) % choices.length;
        else if (e.key === "enter") return this.choosePriority(this.at);
        else if (e.key === "escape" || e.key === "left") {
          this.sub = null;
          this.at = 0;
        } else return;
        this.priorityScroll.scroll_to_item(this.at + 1);
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex()
          .id("pri-back")
          .px(8)
          .pt(4)
          .pb(6)
          .gap(5)
          .items_center()
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            this.sub = null;
            this.at = 0;
            cx.notify();
          })
          .child(svg("mods/workspace-chrome/chevron-left.svg").size(11))
          .child("Priority"),
      )
      .children(
        choices.map((p, i) =>
          h_flex()
            .id(`pri-${p.id ?? "none"}`)
            .h(30)
            .flex_none()
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .text_color(t[p.tone] ?? t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.choosePriority(i))
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

  render() {
    const t = theme();
    const p = props();
    if (p?.tab === "rename-agent" || p?.tab === "restart-agent")
      return this.renderAgentAction(t, p);
    if (this.sub === "priority") return this.renderPriority(t);
    const list = items(p, this.git);
    const separators = list.filter((_item, i) => separates(list, i)).length;
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .h(Math.min(menuHeight(p), list.length * 31 + separators * 9 + 10))
      .min_h(0)
      .overflow_y_scrollbar()
      .track_scroll(this.scroll)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(p.overlay);
        else if (!list.length) return;
        else if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up")
          this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "home") this.at = 0;
        else if (e.key === "end") this.at = list.length - 1;
        else if (e.key === "enter") this.choose(list[this.at], cx);
        else return;
        this.scroll.scroll_to_item(this.at);
        cx.stop_propagation();
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .flex_none()
            .when(separates(list, i), (el) =>
              el.child(div().mx(7).my(4).h(1).bg(t.border)),
            )
            .child(
              h_flex()
                .id(`mi-${i}`)
                .h(31)
                .flex_none()
                .px(8)
                .gap(9)
                .rounded(7)
                .items_center()
                .justify_between()
                .text_color(isCloseCmd(it[1]) ? t.blocked : t.foreground)
                .when(i === this.at, (el) => el.bg(t.selected))
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.choose(it, cx))
                .child(
                  svg(menuIcon(it[1], it[2]))
                    .size(14)
                    .flex_none()
                    .text_color(isCloseCmd(it[1]) ? t.blocked : t.muted),
                )
                .child(div().flex_1().child(it[0]))
                .child(
                  div()
                    .text_size(11)
                    .text_color(t.dim)
                    .child(shortcut(it[1], it[2])),
                ),
            ),
        ),
      );
  }
}
