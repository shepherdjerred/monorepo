// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "agent" | "subagent" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// "worktree" opens my-worktree, "takeover"/"migrate" opens my-takeover, and "priority" opens an inline priority list.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
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

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], {
    cwd: folder,
    on,
  });
  const common = await exec(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: folder, on },
  );
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git`
    ? "main"
    : "linked";
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
        ...(tg.tab ? [["Rename tab", "tab.rename", { id: tg.tab }]] : []),
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
          ? [
              ["Close pane", "pane.close", { pane: tg.pane }],
              ["Close tab", "tab.close", { id: tg.tab }],
            ]
          : tg.tab
            ? [["Close", "tab.close", { id: tg.tab }]]
            : [["Close", "terminal.kill", { terminal: tg.address }]]),
        ...(spaceTabs > 1 && tg.space
          ? [["Close space", "space.close", { id: tg.space }]]
          : []),
      ];
    }
    case "subagent":
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
        ["Close", "terminal.kill", { terminal: tg.address }],
      ];
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
    if (checking()) return;
    this.handle.focus();
    const p = props();
    const spaceId =
      p?.tab === "space"
        ? p.target?.id
        : p?.tab === "agent"
          ? p.target?.space
          : null;
    const space = spaceId && spaces().find((s) => s.id === spaceId);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
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

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    if (it[1] === "priority") {
      const current = priorityOf(it[2].address);
      const idx = this.priorityChoices().findIndex((p) => p.id === current);
      this.sub = "priority";
      this.at = Math.max(0, idx);
      cx.notify();
      return;
    }
    closeOverlay(props()?.overlay);
    if (it[1] === "worktree")
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

  renderPriority(t) {
    const address = props()?.target?.address;
    const current = priorityOf(address);
    const choices = this.priorityChoices();
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
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
    if (this.sub === "priority") return this.renderPriority(t);
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up")
          this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(
              i > 0 &&
                ((isCloseCmd(it[1]) && !isCloseCmd(list[i - 1][1])) ||
                  it[1] === "app.help" ||
                  (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")),
              (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)),
            )
            .child(
              h_flex()
                .id(`mi-${i}`)
                .h(31)
                .px(8)
                .gap(9)
                .rounded(7)
                .items_center()
                .justify_between()
                .text_color(isCloseCmd(it[1]) ? t.blocked : t.foreground)
                .when(i === this.at, (el) => el.bg(t.selected))
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.choose(i, cx))
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
