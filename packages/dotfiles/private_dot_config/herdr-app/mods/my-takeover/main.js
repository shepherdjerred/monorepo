// Session takeover & cross-machine migration dialog: { terminal?, pane?, tab?, space?, pickMachine? }.
// Hands off a stalled or quota-exhausted agent session to another Brim-ranked
// provider in the same space/tab slot, or migrates the session to another machine.
// Enter starts ~/bin/herdr-takeover detached and closes immediately.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Scrollbar } from "gpui-base";
import {
  checking,
  props,
  closeOverlay,
  theme,
  spaces,
  machines,
  panes,
  agents,
  terminals,
  focused,
  exec,
  hc,
  readTextFile,
  home,
  knownAgents,
  window,
} from "herdr";
import {
  CLAUDE_MODELS,
  agentArgs,
  capabilities,
  parseAgyModels,
  parseCodexModels,
  parseGrokModels,
  parseKimiModels,
} from "./agents.js";

const CATALOGS = {
  "claude-code": async () => CLAUDE_MODELS,
  codex: async (on, userHome) =>
    parseCodexModels(
      (await readTextFile(`${userHome}/.codex/models_cache.json`, { on })) ??
        "{}",
    ),
  antigravity: async (on) =>
    parseAgyModels(await output("agy", ["models"], on)),
  grok: async (on) => parseGrokModels(await output("grok", ["models"], on)),
  kimi: async (on, userHome) =>
    parseKimiModels(
      (await readTextFile(`${userHome}/.kimi-code/config.toml`, { on })) ?? "",
    ),
};

async function output(command, args, on) {
  const r = await exec(command, args, { on });
  if (r.code !== 0)
    throw new Error(
      (r.stderr || r.stdout).trim().split("\n")[0] || `${command} failed`,
    );
  return r.stdout;
}

function stored(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const NO_CHOICE = { mode: null, model: null, effort: null };

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

const DISPLAY_NAME = {
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  cursor: "Cursor",
  grok: "Grok",
  kimi: "Kimi",
  muse: "Muse",
};

const ICON = {
  "claude-code": "mods/my-status/icons/claude.svg",
  codex: "mods/my-status/icons/codex.svg",
  antigravity: "mods/my-status/icons/antigravity.svg",
  cursor: "icons/cursor.svg",
  grok: "icons/grok.svg",
  kimi: "mods/my-status/icons/kimi.svg",
  muse: "icons/muse.svg",
};

const MACHINE_TITLES = {
  "jerreds-macbook-pro": "MacBook",
  macbook: "MacBook",
  "jerred-desktop": "Windows",
  desktop: "Windows",
  "mac-mini": "Karpathy",
  karpathy: "Karpathy",
  jobs: "Jobs",
  "jerreds-mac-mini": "Jobs",
};

const MACHINE_ORDER = {
  MacBook: 1,
  Karpathy: 2,
  Windows: 3,
  Jobs: 4,
};

const DEVICE_ICONS = {
  "jerreds-macbook-pro": "laptop",
  macbook: "laptop",
  karpathy: "mac-mini-top",
  "mac-mini": "mac-mini-top",
  jobs: "mac-mini-top",
  "jerreds-mac-mini": "mac-mini-top",
  desktop: "windows",
  "jerred-desktop": "windows",
};

function hostKey(value) {
  if (value == null) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\.local$/, "");
}

function machineTitle(name, info, localHost, platform) {
  const keys = name == null ? [localHost] : [name, info?.host, info?.target];
  for (const key of keys) {
    const title = MACHINE_TITLES[hostKey(key)];
    if (title) return title;
  }
  if (name == null) return platform === "windows" ? "Windows" : "MacBook";
  return name;
}

function machineIconPath(name, info, localHost, platform) {
  const keys = name == null ? [localHost] : [name, info?.target, info?.host];
  for (const key of keys) {
    const icon = DEVICE_ICONS[hostKey(key)];
    if (icon) return `mods/my-agents/${icon}.svg`;
  }
  if (name == null)
    return `mods/my-agents/${platform === "windows" ? "windows" : "laptop"}.svg`;
  return "mods/workspace-chrome/server.svg";
}

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

const pct = (n) => `${Math.round(n * 10) / 10}%`;
const usedOf = (e) => e.budgetUsed ?? e.fallbackWindow?.[1] ?? null;

function stats(e) {
  const parts = [];
  if (e.budgetUsed != null && e.budgetKind)
    parts.push(`${e.budgetKind} ${pct(e.budgetUsed)}`);
  else if (e.fallbackWindow)
    parts.push(`${e.fallbackWindow[0]} ${pct(e.fallbackWindow[1])}`);
  parts.push(`5h ${e.fiveHourUsed == null ? "n/a" : pct(e.fiveHourUsed)}`);
  if (e.pace) parts.push(e.pace);
  if (e.budgetResetsIn) parts.push(e.budgetResetsIn);
  return parts.join(" · ");
}

function pressure(e, t) {
  const used = usedOf(e);
  return used == null || used <= 70
    ? t.done
    : used <= 90
      ? t.working
      : t.blocked;
}

function providerIcon(provider, displayName, t, faded, size = 16) {
  const color = faded ? t.dim : t.muted;
  if (provider && ICON[provider])
    return svg(ICON[provider]).size(size).flex_none().text_color(color);
  return div()
    .size(size)
    .flex_none()
    .rounded(4)
    .bg(t.border)
    .text_size(Math.max(9, size - 6))
    .text_color(color)
    .flex()
    .items_center()
    .justify_center()
    .child((displayName || "?").slice(0, 1));
}

function place(s, all) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function sessionLabel(tab, pane, space) {
  if (tab.named && tab.name) return tab.name;
  const prog = pane?.program?.name;
  const live = clean(pane?.title);
  const telling =
    live &&
    live !== prog &&
    !/^[~/]|^[A-Za-z]:\\/.test(live) &&
    !live.includes("@") &&
    live.toLowerCase() !== pane?.program?.key;
  if (telling) return live;
  return space?.name || tab.name || "Session";
}

function resolveTarget(rawProps) {
  const p = rawProps ?? {};
  const allSpaces = spaces();
  const allPanes = panes();
  const allAgents = agents();
  const allTerms = terminals();
  const termByAddr = new Map(allTerms.map((k) => [k.address, k]));
  const providerOf = (pane, term) =>
    PROVIDER[pane?.app] ??
    PROVIDER[pane?.program?.key] ??
    PROVIDER[term?.report?.app] ??
    PROVIDER[term?.program?.key] ??
    fromArgv(term?.argv) ??
    null;
  const isAgent = (pane) => {
    if (!pane?.terminal) return false;
    const term = termByAddr.get(pane.terminal);
    return Boolean(
      pane.program?.agent ||
      pane.status ||
      term?.program?.agent ||
      term?.status ||
      providerOf(pane, term),
    );
  };

  let paneInfo = null;
  if (p.pane || p.terminal) {
    paneInfo =
      (p.pane && allPanes.find((x) => x.pane === p.pane)) ||
      (p.terminal && allPanes.find((x) => x.terminal === p.terminal)) ||
      null;
  } else {
    const f = focused();
    const focPane =
      (f?.pane && allPanes.find((x) => x.pane === f.pane)) ||
      allPanes.find((x) => x.focused && x.terminal);
    if (focPane && isAgent(focPane)) {
      paneInfo = focPane;
    } else {
      const activeSpace =
        (f?.space && allSpaces.find((s) => s.id === f.space)) ||
        allSpaces.find((s) => s.active);
      const activeTab =
        (f?.tab && activeSpace?.tabs?.find((c) => c.id === f.tab)) ||
        activeSpace?.tabs?.find((c) => c.active);
      if (activeTab) {
        const tabPanes = allPanes.filter(
          (x) => x.tab === activeTab.id && x.terminal,
        );
        paneInfo =
          tabPanes.find((x) => x.focused && isAgent(x)) ||
          tabPanes.find((x) => isAgent(x)) ||
          null;
      }
      if (!paneInfo && f?.agent) {
        const ag = allAgents.find((a) => a.address === f.agent);
        if (ag)
          paneInfo =
            allPanes.find(
              (x) => x.pane === ag.pane || x.terminal === ag.address,
            ) || null;
      }
    }
  }

  if (!paneInfo?.terminal) return null;
  const terminal = p.terminal || paneInfo.terminal;
  const term = termByAddr.get(terminal);
  if (term?.state && term.state !== "live") return null;

  const tabId = p.tab || paneInfo.tab;
  const space =
    (p.space && allSpaces.find((s) => s.id === p.space)) ||
    allSpaces.find((s) => (s.tabs ?? []).some((c) => c.id === tabId));
  const tab = space?.tabs?.find((c) => c.id === tabId);
  if (!space || !tab) return null;

  const tabIndex =
    tab.index ??
    (Math.max(
      0,
      space.tabs.findIndex((c) => c.id === tab.id),
    ) + 1 ||
      1);
  const paneCount =
    tab.panes ?? allPanes.filter((x) => x.tab === tab.id).length;
  const sourceProvider = providerOf(paneInfo, term);
  const sourceDisplayName =
    DISPLAY_NAME[sourceProvider] ||
    paneInfo.program?.name ||
    term?.program?.name ||
    "Agent";

  return {
    terminal,
    pane: paneInfo.pane,
    space: space.id,
    spaceName: space.name ?? null,
    spaceTabCount: space.tabs?.length ?? 2,
    machine: space.machine ?? null,
    tab: tab.id,
    tabIndex,
    tabName: tab.named && tab.name ? tab.name : null,
    splitTab: paneCount > 1,
    cwd: paneInfo.cwd || place(space, allPanes) || "",
    sourceProvider,
    sourceDisplayName,
    sessionTitle: sessionLabel(tab, paneInfo, space),
  };
}

export default class Takeover extends View {
  init(_props, cx) {
    const rawProps = props();
    this.target = resolveTarget(rawProps);
    this.sourceMachine = this.target?.machine ?? null;
    this.targetMachine = this.sourceMachine;
    this.on = this.targetMachine;
    this.userHome = this.targetMachine ? null : home();
    this.windowsTarget =
      !this.targetMachine && window()?.platform === "windows";
    this.machineInfos = {};
    this.hostName = "";
    this.machineLoadSeq = 0;
    this.gitCheck = null;
    this.prepared = null;
    this.userPickedProvider = false;
    this.manualProvider = null;
    this.userMovedOption = false;
    this.pickMachineOnOpen = Boolean(this.target && rawProps?.pickMachine);
    this.text = "";
    this.choice = {};
    this.catalogs = {};
    this.choosing =
      this.pickMachineOnOpen && this.machineOptions().length > 1
        ? "machine"
        : null;
    this.optionAt =
      this.choosing === "machine" ? this.defaultMachineOptionIndex(true) : 0;
    this.agents = undefined;
    this.pick = 0;
    this.error = "";
    this.handle = cx.focus_handle();
    this.input = TextareaState.new({
      placeholder:
        "Optional handoff note (Enter to take over, Shift+Enter for new line)",
    });
    this.input.set_auto_grow(2, 5);
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      this.error = "";
      cx.notify();
    });
    this.input.on("submit", (e, cx) => {
      if (e?.shift) return;
      if (this.choosing) this.chooseAt(this.optionAt, cx);
      else this.go(cx);
    });
    this.inputFocused = Boolean(this.target);
    this.input.on("focus", (_e, cx) => {
      this.inputFocused = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.inputFocused = false;
      cx.notify();
    });

    if (checking()) return;

    if (!this.target) {
      this.handle.focus();
      cx.timer.after(100, () => this.handle.focus());
      return;
    }

    this.input.focus();
    cx.timer.after(600, () => this.input.focus());

    this.loadMachineMetadata(cx);
    this.runGitPreflight(cx);
    this.reloadTargetMachine(this.targetMachine, cx);
  }

  loadMachineMetadata(cx) {
    cx.spawn(async (cx) => {
      try {
        const [lsRes, hostRes] = await Promise.all([
          hc(["machine", "ls", "--json"]).catch(() => null),
          exec("hostname", []).catch(() => null),
        ]);
        if (lsRes?.code === 0) {
          const parsed = JSON.parse(lsRes.stdout);
          this.machineInfos = Object.fromEntries(
            (parsed.machines ?? [])
              .filter((m) => !m.temporary)
              .map((m) => [m.name, m]),
          );
        }
        if (hostRes?.code === 0 && hostRes.stdout.trim()) {
          this.hostName = hostRes.stdout.trim().replace(/\.local$/, "");
        }
        if (this.pickMachineOnOpen && !this.userMovedOption) {
          if (!this.choosing && this.machineOptions().length > 1) {
            this.choosing = "machine";
          }
          if (this.choosing === "machine") {
            this.optionAt = this.defaultMachineOptionIndex(true);
          }
        }
        cx.notify();
      } catch {}
    });
  }

  machineOptions() {
    const platform = window()?.platform;
    const live = machines();
    const byName = new Map();
    byName.set(null, "ready");
    for (const m of live) {
      byName.set(m.name ?? null, m.layout);
    }
    for (const m of Object.values(this.machineInfos)) {
      if (!byName.has(m.name)) {
        byName.set(m.name, m.state === "connected" ? "ready" : "unavailable");
      }
    }
    if (this.sourceMachine && !byName.has(this.sourceMachine)) {
      byName.set(this.sourceMachine, "ready");
    }
    if (this.targetMachine && !byName.has(this.targetMachine)) {
      byName.set(this.targetMachine, "ready");
    }
    const list = [...byName.entries()].map(([name, layoutState]) => {
      const info = name ? this.machineInfos[name] : null;
      const title = machineTitle(name, info, this.hostName, platform);
      const icon = machineIconPath(name, info, this.hostName, platform);
      return {
        name,
        title,
        icon,
        layout: layoutState,
        ready: layoutState !== "unavailable",
        isSource: (name ?? null) === (this.sourceMachine ?? null),
        isTarget: (name ?? null) === (this.targetMachine ?? null),
      };
    });
    const rank = (entry) => MACHINE_ORDER[entry.title] ?? 99;
    list.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.title.localeCompare(b.title) ||
        String(a.name ?? "").localeCompare(String(b.name ?? "")),
    );
    return list;
  }

  machineTitleOf(name) {
    const found = this.machineOptions().find(
      (m) => (m.name ?? null) === (name ?? null),
    );
    if (found) return found.title;
    return machineTitle(
      name ?? null,
      name ? this.machineInfos[name] : null,
      this.hostName,
      window()?.platform,
    );
  }

  machineIconOf(name) {
    const found = this.machineOptions().find(
      (m) => (m.name ?? null) === (name ?? null),
    );
    if (found) return found.icon;
    return machineIconPath(
      name ?? null,
      name ? this.machineInfos[name] : null,
      this.hostName,
      window()?.platform,
    );
  }

  defaultMachineOptionIndex(preferOther = false) {
    const list = this.machineOptions();
    if (preferOther) {
      const other = list.findIndex(
        (m) => m.ready && (m.name ?? null) !== (this.sourceMachine ?? null),
      );
      if (other >= 0) return other;
    }
    const current = list.findIndex(
      (m) => (m.name ?? null) === (this.targetMachine ?? null),
    );
    return current >= 0 ? current : 0;
  }

  toggleMachinePicker(cx, preferOther = false) {
    const list = this.machineOptions();
    if (list.length <= 1) return;
    if (this.choosing === "machine") {
      this.choosing = null;
    } else {
      this.choosing = "machine";
      this.userMovedOption = false;
      this.optionAt = this.defaultMachineOptionIndex(preferOther);
    }
    cx.notify();
  }

  async resolveTargetEnv(machine) {
    if (!machine) {
      return {
        windowsTarget: window()?.platform === "windows",
        userHome: home(),
      };
    }
    let windowsTarget = false;
    let result;
    try {
      result = await exec("sh", ["-c", 'printf %s "$HOME"'], {
        on: machine,
      });
    } catch {}
    if (!result || result.code !== 0 || !result.stdout.trim()) {
      result = await exec(
        "powershell.exe",
        ["-NoProfile", "-Command", "[Console]::Write($HOME)"],
        { on: machine },
      );
      windowsTarget = true;
    }
    if (result.code !== 0 || !result.stdout.trim())
      throw new Error("Could not find the remote home folder.");
    return {
      windowsTarget,
      userHome: result.stdout.trim().replace(/\\/g, "/"),
    };
  }

  reloadTargetMachine(machine, cx) {
    const seq = ++this.machineLoadSeq;
    cx.spawn(async (cx) => {
      try {
        const env = await this.resolveTargetEnv(machine);
        if (seq !== this.machineLoadSeq) return;
        this.windowsTarget = env.windowsTarget;
        this.userHome = env.userHome;
        await this.loadAgents(cx, seq);
        if (seq !== this.machineLoadSeq) return;
        this.loadCatalog(this.provider(), cx);
        cx.notify();
      } catch (error) {
        if (seq !== this.machineLoadSeq) return;
        this.error = error instanceof Error ? error.message : String(error);
        cx.notify();
      }
    });
  }

  selectMachine(nextMachine, cx) {
    const normalized = nextMachine ?? null;
    this.pickMachineOnOpen = false;
    this.choosing = null;
    this.error = "";
    if (normalized === (this.targetMachine ?? null)) {
      cx.notify();
      return;
    }
    this.targetMachine = normalized;
    this.on = normalized;
    this.windowsTarget = !normalized && window()?.platform === "windows";
    this.userHome = normalized ? null : home();
    this.catalogs = {};
    this.agents = undefined;
    cx.notify();
    this.reloadTargetMachine(normalized, cx);
  }

  runGitPreflight(cx) {
    const cwd = this.target?.cwd || "";
    const on = this.sourceMachine ?? null;
    const opts = { ...(cwd ? { cwd } : {}), on };
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], opts);
        if (top.code !== 0) {
          this.gitCheck = { state: "non-git", branch: null, blocker: null };
          cx.notify();
          return;
        }
        const status = await exec(
          "git",
          [
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "status",
            "--porcelain",
          ],
          opts,
        );
        if (status.code !== 0) {
          this.gitCheck = {
            state: "blocked",
            branch: null,
            blocker:
              status.stderr.trim().split("\n")[0] ||
              "Could not read git status on source checkout.",
          };
          cx.notify();
          return;
        }
        if (status.stdout.trim() !== "") {
          this.gitCheck = {
            state: "blocked",
            branch: null,
            blocker:
              "Source checkout has uncommitted or untracked changes — commit and push to origin first.",
          };
          cx.notify();
          return;
        }
        const origin = await exec("git", ["remote", "get-url", "origin"], opts);
        if (origin.code !== 0 || !origin.stdout.trim()) {
          this.gitCheck = {
            state: "blocked",
            branch: null,
            blocker: "Source repository has no 'origin' remote configured.",
          };
          cx.notify();
          return;
        }
        const [symRef, headRes, unpushed] = await Promise.all([
          exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], opts),
          exec("git", ["rev-parse", "HEAD"], opts),
          exec(
            "git",
            [
              "--no-optional-locks",
              "rev-list",
              "-n1",
              "HEAD",
              "--not",
              "--remotes=origin",
            ],
            opts,
          ),
        ]);
        const branch = symRef.code === 0 ? symRef.stdout.trim() : "";
        const headSha = headRes.code === 0 ? headRes.stdout.trim() : "";
        if (headRes.code !== 0 || !headSha) {
          this.gitCheck = {
            state: "blocked",
            branch: branch || null,
            blocker:
              "Source repository has no commits on HEAD yet — commit and push to origin first.",
          };
          cx.notify();
          return;
        }
        if (unpushed.code !== 0 || unpushed.stdout.trim() !== "") {
          let pushedOnOrigin = false;
          if (branch) {
            const lsRemote = await exec(
              "git",
              ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
              { ...opts, timeout: 15000 },
            );
            const remoteSha =
              lsRemote.code === 0 ? lsRemote.stdout.trim().split(/\s+/)[0] : "";
            pushedOnOrigin = Boolean(remoteSha && remoteSha === headSha);
          }
          if (!pushedOnOrigin) {
            this.gitCheck = {
              state: "blocked",
              branch: branch || null,
              blocker: `${branch ? `Branch "${branch}"` : "HEAD"} has unpushed commits — push to origin before moving machines.`,
            };
            cx.notify();
            return;
          }
        }
        this.gitCheck = {
          state: "clean",
          branch: branch || headSha.slice(0, 8),
          blocker: null,
        };
      } catch (error) {
        this.gitCheck = {
          state: "blocked",
          branch: null,
          blocker: `Could not verify git status on source machine: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      cx.notify();
    });
  }

  async loadAgents(cx, seq = this.machineLoadSeq) {
    const src = this.target?.sourceProvider ?? null;
    const crossMachine = this.targetMachine !== this.sourceMachine;
    try {
      let nextAgents;
      if (this.windowsTarget) {
        const seen = new Set();
        const others = [];
        const current = [];
        const quotaResult = await exec("brim", ["--json"], {
          on: this.targetMachine,
        }).catch(() => null);
        const quotas =
          quotaResult?.code === 0 ? JSON.parse(quotaResult.stdout) : null;
        for (const a of await knownAgents({ on: this.targetMachine ?? null })) {
          const provider = PROVIDER[a.key];
          if (!a.installed || !provider || seen.has(provider)) continue;
          seen.add(provider);
          const entry = {
            provider,
            displayName: a.name,
            accountLabel: null,
            planName: null,
            unranked: true,
          };
          if (!crossMachine && provider === src)
            current.push({
              ...entry,
              available: false,
              current: true,
              reason: "current — taking over",
            });
          else others.push(entry);
        }
        const available = new Set(others.map((entry) => entry.provider));
        const ranked =
          quotas?.ranked.filter((entry) => available.has(entry.provider)) ?? [];
        const other =
          quotas?.other.filter((entry) => available.has(entry.provider)) ?? [];
        const ordered = [...ranked, ...other];
        const used = new Set(ordered.map((entry) => entry.provider));
        nextAgents = {
          choices: [
            ...ordered,
            ...others.filter((entry) => !used.has(entry.provider)),
            ...current,
          ],
          ranked: ranked.length,
          other: other.length,
          unavailable: current.length,
          unranked: ordered.length === 0,
        };
      } else {
        const r = await exec("brim", ["--json"], {
          on: this.targetMachine,
        });
        if (r.code !== 0)
          throw new Error(r.stderr.trim() || `brim --json exited ${r.code}.`);
        const b = JSON.parse(r.stdout);
        if (crossMachine) {
          const ranked = b.ranked ?? [];
          const other = b.other ?? [];
          const unavailable = b.unavailable ?? [];
          nextAgents = {
            choices: [...ranked, ...other, ...unavailable],
            ranked: ranked.length,
            other: other.length,
            unavailable: unavailable.length,
          };
        } else {
          const ranked = (b.ranked ?? []).filter((e) => e.provider !== src);
          const other = (b.other ?? []).filter((e) => e.provider !== src);
          const unavailOthers = (b.unavailable ?? []).filter(
            (e) => e.provider !== src,
          );
          const srcEntry = [
            ...(b.ranked ?? []),
            ...(b.other ?? []),
            ...(b.unavailable ?? []),
          ].find((e) => e.provider === src);
          const unavailable = srcEntry
            ? [
                ...unavailOthers,
                {
                  ...srcEntry,
                  available: false,
                  current: true,
                  reason: "current — taking over",
                },
              ]
            : unavailOthers;
          nextAgents = {
            choices: [...ranked, ...other, ...unavailable],
            ranked: ranked.length,
            other: other.length,
            unavailable: unavailable.length,
          };
        }
      }
      if (seq !== this.machineLoadSeq) return;
      this.agents = nextAgents;
      const choices = nextAgents.choices;
      let nextPick = 0;
      if (this.userPickedProvider && this.manualProvider) {
        const manualIdx = choices.findIndex(
          (e) => e.provider === this.manualProvider && e.available !== false,
        );
        if (manualIdx >= 0) nextPick = manualIdx;
      } else if (crossMachine && src) {
        const srcIdx = choices.findIndex((e) => {
          if (e.provider !== src || e.available === false) return false;
          const used = usedOf(e);
          return used == null || used < 100;
        });
        if (srcIdx >= 0) nextPick = srcIdx;
      }
      this.pick = nextPick;
      this.loadCatalog(this.provider(), cx);
    } catch (error) {
      if (seq !== this.machineLoadSeq) return;
      this.agents = {
        choices: [],
        ranked: 0,
        other: 0,
        unavailable: 0,
        unranked: this.windowsTarget,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    cx.notify();
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  provider() {
    return this.agents?.choices[this.pick]?.provider ?? null;
  }

  pickedEntry() {
    return this.agents?.choices[this.pick] ?? null;
  }

  choiceFor(provider) {
    return (
      this.choice[provider] ??
      (this.choice[provider] = {
        ...NO_CHOICE,
        ...stored(`choice:${provider}`),
      })
    );
  }

  go(cx) {
    if (!this.target) return this.close();
    this.error = this.startInBackground();
    if (!this.error) this.close();
    cx.notify();
  }

  startInBackground() {
    const crossMachine = this.targetMachine !== this.sourceMachine;
    if (crossMachine) {
      if (!this.gitCheck)
        return `Checking git status on ${this.machineTitleOf(this.sourceMachine)}…`;
      if (this.gitCheck.blocker) return this.gitCheck.blocker;
    }
    if (!this.agents)
      return this.windowsTarget
        ? "Still finding agents on target machine."
        : "Still asking Brim for the agents.";
    const picked = this.pickedEntry();
    const provider = this.provider();
    if (!provider) return "No replacement agent available.";
    if (!crossMachine && picked?.current)
      return "Choose a different agent on this machine, or move to another machine.";
    let args = [];
    let safe = false;
    try {
      ({ args, safe } = agentArgs(provider, this.choiceFor(provider)));
    } catch (error) {
      return error.message;
    }
    const cwd =
      this.target.cwd || (!crossMachine ? this.userHome || home() : "");
    const rawNote = this.text.trim();
    const note = rawNote ? rawNote : null;
    const sourceSpace = spaces().find((s) => s.id === this.target.space);
    const targetRepoCandidates = [
      ...new Set(
        spaces()
          .filter(
            (s) =>
              (s.machine ?? null) === (this.targetMachine ?? null) && s.folder,
          )
          .map((s) => s.folder),
      ),
    ];
    const request = {
      terminal: this.target.terminal,
      space: this.target.space,
      tab: this.target.tab,
      tabIndex: this.target.tabIndex,
      spaceTabCount:
        sourceSpace?.tabs?.length ?? this.target.spaceTabCount ?? 2,
      spaceName: sourceSpace?.name ?? this.target.spaceName ?? null,
      tabName: this.target.tabName,
      pane: this.target.pane,
      splitTab: this.target.splitTab,
      cwd,
      provider,
      machine: this.sourceMachine ?? null,
      targetMachine: this.targetMachine ?? null,
      targetRepoCandidates,
      agentArgs: args,
      safe,
      launcher: this.windowsTarget ? "profile" : "brim",
      note,
      prepared: !crossMachine && this.prepared ? this.prepared : null,
    };
    if (window()?.platform === "windows") {
      const quoted = (s) => `'${s.replaceAll("'", "''")}'`;
      exec("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          `$env:HERDR_TAKEOVER_REQUEST = ${quoted(JSON.stringify(request))}`,
          `Start-Process -WindowStyle Hidden -WorkingDirectory ${quoted(home())} -FilePath bun -ArgumentList ${quoted(`"${home()}/bin/herdr-takeover.ts"`)}, '--request-env'`,
        ].join("; "),
      ]);
    } else
      exec("sh", [
        "-c",
        'nohup "$0" "$1" >/dev/null 2>&1 &',
        `${home()}/bin/herdr-takeover`,
        JSON.stringify(request),
      ]);
    return "";
  }

  loadCatalog(provider, cx) {
    if (!provider || !CATALOGS[provider] || !this.userHome || checking())
      return;
    if (this.catalogs[provider]?.fresh) return;
    const machineKey = this.targetMachine ?? "local";
    const userHome = this.userHome;
    const on = this.targetMachine ?? null;
    const key = `catalog:${machineKey}:${provider}`;
    const cached = stored(key);
    this.catalogs[provider] = {
      models: cached ?? [],
      fresh: true,
      error: null,
    };
    cx.spawn(async (cx) => {
      try {
        const models = await CATALOGS[provider](on, userHome);
        if ((this.targetMachine ?? "local") !== machineKey) return;
        this.catalogs[provider] = { models, fresh: true, error: null };
        store(key, models);
      } catch (error) {
        if ((this.targetMachine ?? "local") !== machineKey) return;
        this.catalogs[provider] = {
          models: cached ?? [],
          fresh: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      cx.notify();
    });
  }

  options(kind, provider) {
    const caps = capabilities(provider);
    const none = { id: null, label: "Default" };
    if (kind === "mode")
      return [none, ...caps.modes.map((m) => ({ id: m.id, label: m.label }))];
    if (kind === "model")
      return [none, ...(this.catalogs[provider]?.models ?? [])];
    const model = this.catalogs[provider]?.models.find(
      (m) => m.id === this.choiceFor(provider).model,
    );
    const efforts = model?.efforts ?? caps.efforts;
    return [none, ...efforts.map((e) => ({ id: e, label: e }))];
  }

  offers(kind, provider) {
    if (!provider) return false;
    const caps = capabilities(provider);
    return kind === "mode"
      ? caps.modes.length > 0
      : kind === "model"
        ? Boolean(caps.model && CATALOGS[provider])
        : Boolean(caps.effort);
  }

  choose(kind, id, provider, cx) {
    const choice = this.choiceFor(provider);
    choice[kind] = id;
    if (
      kind === "model" &&
      choice.effort &&
      !this.options("effort", provider).some((o) => o.id === choice.effort)
    )
      choice.effort = null;
    store(`choice:${provider}`, choice);
    this.choosing = null;
    this.error = "";
    cx.notify();
  }

  chooseAt(i, cx) {
    if (this.choosing === "machine") {
      const m = this.machineOptions()[i];
      if (m && m.ready) this.selectMachine(m.name, cx);
      return;
    }
    const provider = this.provider();
    if (!provider) return;
    const option = this.options(this.choosing, provider)[i];
    if (option) this.choose(this.choosing, option.id, provider, cx);
  }

  cycle(kind, step, cx) {
    const provider = this.provider();
    if (!provider || !this.offers(kind, provider)) return;
    this.loadCatalog(provider, cx);
    const list = this.options(kind, provider);
    const now = list.findIndex((o) => o.id === this.choiceFor(provider)[kind]);
    const next = list[(Math.max(0, now) + step + list.length) % list.length];
    this.choose(kind, next.id, provider, cx);
  }

  key(e, cx) {
    if (e.key === "escape" && this.choosing) {
      this.choosing = null;
      this.pickMachineOnOpen = false;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "escape") return this.close();
    if (!this.target) {
      if (e.key === "enter") return this.close();
      return;
    }
    if (e.key === "enter" && !e.modifiers?.shift && !this.inputFocused) {
      cx.stop_propagation();
      if (this.choosing) return this.chooseAt(this.optionAt, cx);
      return this.go(cx);
    }
    const isAltD =
      e.keystroke === "alt-d" ||
      (Boolean(e.alt || e.modifiers?.alt) &&
        !e.modifiers?.control &&
        !e.modifiers?.platform &&
        !e.modifiers?.shift &&
        (e.key ?? "").toLowerCase() === "d");
    if (isAltD && this.machineOptions().length > 1) {
      this.toggleMachinePicker(cx, this.targetMachine === this.sourceMachine);
      return cx.stop_propagation();
    }
    const shortcut = {
      "alt-m": ["mode", 1],
      "alt-shift-m": ["mode", -1],
      "alt-o": ["model", 1],
      "alt-shift-o": ["model", -1],
      "alt-e": ["effort", 1],
      "alt-shift-e": ["effort", -1],
    }[e.keystroke];
    if (shortcut) {
      this.cycle(shortcut[0], shortcut[1], cx);
      return cx.stop_propagation();
    }
    const vertical = e.key === "down" || e.key === "up";
    if (this.choosing === "machine" && vertical) {
      const list = this.machineOptions();
      const n = list.length;
      if (n > 0) {
        const step = e.key === "down" ? 1 : n - 1;
        let next = this.optionAt;
        for (let k = 0; k < n; k++) {
          next = (next + step) % n;
          if (list[next]?.ready) break;
        }
        if (list[next]?.ready) {
          this.optionAt = next;
          this.userMovedOption = true;
        }
      }
      cx.stop_propagation();
      return cx.notify();
    }
    if (this.choosing && vertical) {
      const provider = this.provider();
      if (!provider) return;
      const n = this.options(this.choosing, provider).length;
      if (n > 0) {
        this.optionAt = (this.optionAt + (e.key === "down" ? 1 : n - 1)) % n;
      }
      cx.stop_propagation();
      return cx.notify();
    }
    const n = this.agents?.choices.length ?? 0;
    if (n && vertical) {
      this.pick = (this.pick + (e.key === "down" ? 1 : n - 1)) % n;
      const picked = this.pickedEntry();
      if (picked && picked.available !== false) {
        this.userPickedProvider = true;
        this.manualProvider = picked.provider;
      }
      this.loadCatalog(this.provider(), cx);
      cx.stop_propagation();
      cx.notify();
    }
  }

  renderChoices(t) {
    const provider = this.provider();
    const machinesList = this.machineOptions();
    const hasMultipleMachines = machinesList.length > 1;
    const kinds = provider
      ? ["mode", "model", "effort"].filter((k) => this.offers(k, provider))
      : [];
    if (!hasMultipleMachines && kinds.length === 0) return div();

    const chips = [];
    if (hasMultipleMachines) {
      const open = this.choosing === "machine";
      const crossMachine = this.targetMachine !== this.sourceMachine;
      const targetTitle = this.machineTitleOf(this.targetMachine);
      chips.push(
        h_flex()
          .id("choice-machine")
          .flex_none()
          .h(24)
          .px(8)
          .gap(4)
          .items_center()
          .rounded(6)
          .border(1)
          .border_color(open || crossMachine ? t.accent : t.border)
          .when(crossMachine, (el) => el.bg(t.selected))
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.toggleMachinePicker(cx, false))
          .child(
            div()
              .text_size(11)
              .text_color(crossMachine ? t.accent : t.dim)
              .child("Machine"),
          )
          .child(
            div()
              .text_size(12)
              .when(crossMachine, (el) => el.font_medium())
              .text_color(crossMachine ? t.accent : t.foreground)
              .child(`${targetTitle} \u25be`),
          ),
      );
    }

    if (provider) {
      const choice = this.choiceFor(provider);
      for (const kind of kinds) {
        const label =
          this.options(kind, provider).find((o) => o.id === choice[kind])
            ?.label ?? choice[kind];
        const open = this.choosing === kind;
        chips.push(
          h_flex()
            .id(`choice-${kind}`)
            .flex_none()
            .h(24)
            .px(8)
            .gap(4)
            .items_center()
            .rounded(6)
            .border(1)
            .border_color(open ? t.accent : t.border)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              this.choosing = open ? null : kind;
              this.optionAt = Math.max(
                0,
                this.options(kind, provider).findIndex(
                  (o) => o.id === choice[kind],
                ),
              );
              if (kind === "model") this.loadCatalog(provider, cx);
              cx.notify();
            })
            .child(
              div()
                .text_size(11)
                .text_color(t.dim)
                .child(kind[0].toUpperCase() + kind.slice(1)),
            )
            .child(
              div()
                .text_size(12)
                .text_color(choice[kind] ? t.foreground : t.muted)
                .child(`${label} \u25be`),
            ),
        );
      }
    }

    return h_flex().flex_none().gap(6).items_center().children(chips);
  }

  renderMachineOptions(t) {
    const rows = this.machineOptions().map((m, i) => {
      const selected = i === this.optionAt && m.ready;
      return h_flex()
        .id(`machine-option-${m.name ?? "local"}`)
        .flex_none()
        .h(30)
        .px(10)
        .gap(8)
        .items_center()
        .rounded(7)
        .when(m.ready, (el) =>
          el
            .cursor_pointer()
            .when(selected, (s) => s.bg(t.selected))
            .when(!selected, (s) => s.hover((h) => h.bg(t.hover)))
            .on_click((_e, cx) => this.selectMachine(m.name, cx)),
        )
        .child(
          svg(m.icon)
            .size(14)
            .flex_none()
            .text_color(!m.ready ? t.dim : m.isTarget ? t.accent : t.muted),
        )
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .gap(6)
            .items_center()
            .child(
              div()
                .truncate()
                .text_color(!m.ready ? t.dim : t.foreground)
                .when(m.isTarget, (el) => el.font_semibold())
                .child(m.title),
            )
            .when(m.isSource, (el) =>
              el.child(
                div()
                  .flex_none()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("(current)"),
              ),
            )
            .when(!m.ready, (el) =>
              el.child(
                div()
                  .flex_none()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("(offline)"),
              ),
            ),
        )
        .when(m.isTarget, (el) =>
          el.child(
            svg("mods/workspace-chrome/check.svg")
              .size(14)
              .flex_none()
              .text_color(t.accent),
          ),
        );
    });
    return div()
      .relative()
      .flex_1()
      .min_h(0)
      .child(
        v_flex()
          .id("option-list")
          .size_full()
          .overflow_y_scroll()
          .children(rows),
      )
      .child(Scrollbar.vertical("option-list").absolute().inset_0());
  }

  renderOptions(t) {
    if (this.choosing === "machine") return this.renderMachineOptions(t);
    const provider = this.provider();
    if (!provider) return div().flex_1();
    const kind = this.choosing;
    const current = this.choiceFor(provider)[kind];
    const catalog = this.catalogs[provider];
    const rows = this.options(kind, provider).map((o, i) =>
      h_flex()
        .id(`option-${i}`)
        .flex_none()
        .h(28)
        .px(10)
        .gap(8)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(i === this.optionAt, (el) => el.bg(t.selected))
        .when(i !== this.optionAt, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => this.choose(kind, o.id, provider, cx))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_color(t.foreground)
            .when(o.id === current, (el) => el.font_semibold())
            .child(o.label),
        )
        .when(Boolean(o.id && o.label !== o.id), (el) =>
          el.child(
            div().flex_none().text_size(11).text_color(t.dim).child(o.id),
          ),
        ),
    );
    if (kind === "model" && catalog?.error)
      rows.push(
        div()
          .flex_none()
          .px(10)
          .py(4)
          .text_size(11.5)
          .text_color(t.blocked)
          .child(`Model list: ${catalog.error}`),
      );
    return div()
      .relative()
      .flex_1()
      .min_h(0)
      .child(
        v_flex()
          .id("option-list")
          .size_full()
          .overflow_y_scroll()
          .children(rows),
      )
      .child(Scrollbar.vertical("option-list").absolute().inset_0());
  }

  renderPreflight(t, sourceTitle, targetTitle) {
    if (!this.gitCheck) {
      return h_flex()
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11.5)
        .text_color(t.muted)
        .child(
          svg("mods/workspace-chrome/spinner.svg")
            .size(12)
            .flex_none()
            .text_color(t.dim)
            .spin(900),
        )
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .child(`Checking git status on ${sourceTitle}…`),
        );
    }
    if (this.gitCheck.blocker) {
      return h_flex()
        .flex_none()
        .px(10)
        .py(5)
        .gap(8)
        .rounded(6)
        .border(1)
        .border_color(t.blocked)
        .items_center()
        .text_size(11.5)
        .text_color(t.blocked)
        .child(div().flex_1().min_w(0).child(this.gitCheck.blocker))
        .child(
          div()
            .id("recheck-git")
            .flex_none()
            .px(6)
            .py(2)
            .rounded(4)
            .border(1)
            .border_color(t.border)
            .text_size(11)
            .text_color(t.muted)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => {
              this.gitCheck = null;
              if (this.error) this.error = "";
              this.runGitPreflight(cx);
              cx.notify();
            })
            .child("Recheck"),
        );
    }
    if (this.gitCheck.state === "clean") {
      return h_flex()
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11.5)
        .child(div().size(6).flex_none().rounded(3).bg(t.done))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_color(t.muted)
            .child(
              `Ready to fetch ${this.gitCheck.branch} from origin on ${targetTitle} (source tab/space closes once live)`,
            ),
        );
    }
    return h_flex()
      .flex_none()
      .gap(6)
      .items_center()
      .text_size(11.5)
      .child(div().size(6).flex_none().rounded(3).bg(t.dim))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(t.muted)
          .child(
            `Non-git folder — opens matching folder on ${targetTitle} (source tab/space closes once live)`,
          ),
      );
  }

  renderAgents(t) {
    const a = this.agents;
    if (!a)
      return div()
        .text_color(t.dim)
        .child(this.windowsTarget ? "Finding agents…" : "Asking Brim…");
    const heading = (text) =>
      div()
        .flex_none()
        .pt(6)
        .pb(2)
        .px(10)
        .text_size(11)
        .font_semibold()
        .text_color(t.dim)
        .child(text);
    const row = (e, i) => {
      const on = i === this.pick;
      const off = e.available === false;
      const used = off ? null : usedOf(e);
      return h_flex()
        .id(`agent-${e.provider}`)
        .flex_none()
        .h(32)
        .px(10)
        .gap(10)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .when(off, (el) => el.tooltip(e.reason ?? "no data"))
        .on_click((_e, cx) => {
          this.pick = i;
          if (!off) {
            this.userPickedProvider = true;
            this.manualProvider = e.provider;
          }
          this.loadCatalog(this.provider(), cx);
          cx.notify();
        })
        .child(providerIcon(e.provider, e.displayName, t, off && !on))
        .child(
          h_flex()
            .when(off, (el) => el.flex_none())
            .when(!off, (el) => el.flex_1().min_w(0))
            .gap(6)
            .items_center()
            .child(
              div()
                .flex_none()
                .text_color(off && !on ? t.muted : t.foreground)
                .when(on, (el) => el.font_semibold())
                .child(e.displayName),
            )
            .when(Boolean(e.planName ?? e.accountLabel), (el) =>
              el.child(
                div()
                  .id(`plan-${e.provider}`)
                  .min_w(0)
                  .truncate()
                  .text_size(11)
                  .text_color(t.dim)
                  .when(Boolean(e.planName && e.accountLabel), (el) =>
                    el.tooltip(e.accountLabel),
                  )
                  .child(e.planName ?? e.accountLabel),
              ),
            ),
        )
        .when(used != null, (el) =>
          el.child(
            div()
              .flex_none()
              .w(48)
              .h(4)
              .rounded(2)
              .bg(t.border)
              .child(
                div()
                  .h_full()
                  .rounded(2)
                  .bg(pressure(e, t))
                  .w(Math.max(2, Math.round((Math.min(100, used) / 100) * 48))),
              ),
          ),
        )
        .when(!off && !e.unranked, (el) =>
          el.child(
            div()
              .flex_none()
              .w(215)
              .truncate()
              .text_size(11)
              .text_color(on ? t.muted : t.dim)
              .child(stats(e)),
          ),
        )
        .when(off, (el) =>
          el.child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(11)
              .text_color(t.dim)
              .child(e.reason ?? "no data"),
          ),
        );
    };
    const rows = [];
    if (a.choices.length > 0) {
      const topCount = a.unranked ? a.choices.length - a.unavailable : a.ranked;
      if (topCount > 0)
        rows.push(heading(a.unranked ? "Installed" : "Sorted by usage"));
      a.choices.forEach((e, i) => {
        if (a.other && i === a.ranked) rows.push(heading("Other windows"));
        if (a.unavailable && i === (a.unranked ? topCount : a.ranked + a.other))
          rows.push(heading("Unavailable"));
        rows.push(row(e, i));
      });
    } else if (!a.error) {
      rows.push(
        div()
          .flex_none()
          .px(10)
          .py(6)
          .text_color(t.dim)
          .child("No agents available."),
      );
    }
    if (a.error)
      rows.push(
        div()
          .flex_none()
          .px(10)
          .py(4)
          .text_size(11.5)
          .text_color(t.blocked)
          .child(`${a.unranked ? "Agents" : "Brim"}: ${a.error}`),
      );
    return div()
      .relative()
      .flex_1()
      .min_h(0)
      .child(
        v_flex()
          .id("agent-list")
          .size_full()
          .overflow_y_scroll()
          .children(rows),
      )
      .child(Scrollbar.vertical("agent-list").absolute().inset_0());
  }

  renderEmpty(t) {
    return v_flex()
      .id("takeover")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(
            svg("mods/my-takeover/takeover.svg")
              .size(16)
              .flex_none()
              .text_color(t.muted),
          )
          .child(
            div()
              .font_semibold()
              .text_color(t.foreground)
              .child("Take over session"),
          ),
      )
      .child(
        div()
          .text_color(t.muted)
          .child("Focus an agent pane or choose Take over from an agent row."),
      )
      .child(div().flex_1())
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .child("esc close"),
      );
  }

  renderSubtitle(
    t,
    crossMachine,
    sourceTitle,
    targetTitle,
    picked,
    targetLabel,
  ) {
    if (crossMachine) {
      return h_flex()
        .gap(6)
        .items_center()
        .min_w(0)
        .child(
          svg(this.machineIconOf(this.sourceMachine))
            .size(13)
            .flex_none()
            .text_color(t.muted),
        )
        .child(div().flex_none().text_color(t.foreground).child(sourceTitle))
        .child(div().flex_none().text_color(t.dim).child("\u2192"))
        .child(
          svg(this.machineIconOf(this.targetMachine))
            .size(13)
            .flex_none()
            .text_color(t.accent),
        )
        .child(
          div()
            .flex_none()
            .font_medium()
            .text_color(t.accent)
            .child(targetTitle),
        )
        .child(div().flex_none().text_color(t.dim).child("\u00b7"))
        .when(Boolean(picked), (el) =>
          el.child(
            providerIcon(picked.provider, picked.displayName, t, false, 14),
          ),
        )
        .child(
          div()
            .flex_none()
            .font_medium()
            .text_color(t.foreground)
            .child(targetLabel),
        )
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_color(t.muted)
            .child(`\u00b7 ${this.target.sessionTitle}`),
        );
    }
    return h_flex()
      .gap(6)
      .items_center()
      .min_w(0)
      .child(
        providerIcon(
          this.target.sourceProvider,
          this.target.sourceDisplayName,
          t,
          false,
          14,
        ),
      )
      .child(
        div()
          .flex_none()
          .text_color(t.foreground)
          .child(this.target.sourceDisplayName),
      )
      .child(div().flex_none().text_color(t.dim).child("\u2192"))
      .when(Boolean(picked), (el) =>
        el.child(
          providerIcon(picked.provider, picked.displayName, t, false, 14),
        ),
      )
      .child(
        div().flex_none().font_medium().text_color(t.accent).child(targetLabel),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(t.muted)
          .child(`\u00b7 ${this.target.sessionTitle}`),
      );
  }

  render() {
    const t = theme();
    if (!this.target) return this.renderEmpty(t);
    const crossMachine = this.targetMachine !== this.sourceMachine;
    const sourceTitle = this.machineTitleOf(this.sourceMachine);
    const targetTitle = this.machineTitleOf(this.targetMachine);
    const picked = this.pickedEntry();
    const targetLabel = picked?.displayName ?? "…";
    const dialogTitle = crossMachine ? "Move session" : "Take over session";
    const where = crossMachine
      ? `moves to ${targetTitle}`
      : this.target.splitTab
        ? "replaces split pane"
        : "replaces tab";
    const hasMultipleMachines = this.machineOptions().length > 1;
    const isWin = window()?.platform === "windows";
    const machineHint = hasMultipleMachines
      ? `${isWin ? "Alt+D" : "\u2325D"} machine \u00b7 `
      : "";
    const capsHint = isWin
      ? "Alt+M/O/E mode, model, effort"
      : "\u2325M \u2325O \u2325E mode, model, effort";
    const actionHint = crossMachine ? "move" : "take over";
    const showError = Boolean(
      this.error && !(crossMachine && this.error === this.gitCheck?.blocker),
    );
    return v_flex()
      .id("takeover")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(
            svg("mods/my-takeover/takeover.svg")
              .size(15)
              .flex_none()
              .text_color(crossMachine ? t.accent : t.muted),
          )
          .child(
            div()
              .flex_1()
              .font_semibold()
              .text_color(t.foreground)
              .child(dialogTitle),
          )
          .child(
            div()
              .text_size(11)
              .text_color(crossMachine ? t.accent : t.dim)
              .child(where),
          ),
      )
      .child(
        this.renderSubtitle(
          t,
          crossMachine,
          sourceTitle,
          targetTitle,
          picked,
          targetLabel,
        ),
      )
      .child(
        Textarea.new(this.input)
          .px(10)
          .py(6)
          .rounded(6)
          .border(1)
          .border_color(this.inputFocused ? t.accent : t.input)
          .bg(t.background)
          .text_color(t.foreground),
      )
      .child(this.renderChoices(t))
      .when(crossMachine, (el) =>
        el.child(this.renderPreflight(t, sourceTitle, targetTitle)),
      )
      .when(showError, (el) =>
        el.child(div().text_color(t.blocked).child(this.error)),
      )
      .when(Boolean(this.choosing), (el) => el.child(this.renderOptions(t)))
      .when(!this.choosing, (el) => el.child(this.renderAgents(t)))
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .child(
            div()
              .truncate()
              .child(
                this.choosing
                  ? "↑↓ choose · ↵ pick · esc back"
                  : `↑↓ agent · ${machineHint}${capsHint} · ↵ ${actionHint} · ⇧↵ new line · esc cancel`,
              ),
          ),
      );
  }
}
