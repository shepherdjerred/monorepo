// Worktree dialog: { space, action: "new" | "open" | "remove" } or
// { folder, machine } for a repo without a space; optional { branch, tab, argv }.
// New takes the first message for the agent instead of a branch name, plus the
// agent (from Brim's ranking) and its mode, model and effort. Enter hands that
// to ~/bin/herdr-new-worktree and closes: it names the branch and tab with
// OpenAI (naming.js), creates the worktree and opens the space in the
// background. A given { branch } skips naming and runs here.

import { View, div, svg } from "gpui-kit";
import {
  v_flex,
  h_flex,
  InputState,
  Input,
  TextareaState,
  Textarea,
  Scrollbar,
} from "gpui-base";
import {
  run,
  props,
  closeOverlay,
  theme,
  spaces,
  panes,
  exec,
  readTextFile,
  home,
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

// Each agent's model list, from its own catalog on the space's machine (`on`,
// null for this one; `userHome` is that machine's home). Lists are cached in
// localStorage per machine and refreshed once per window per agent.
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

// Agents to start, as `brim --json` ranks them: least used first, then other windows;
// unavailable ones (no usable quota data) last, with Brim's reason, and still startable.
// One starts the way `brim --provider` does (its agent-bin wrapper, on the
// space's machine); Shell starts none.
// One-color icons, the same as my-status's quota chips.
const ICON = {
  "claude-code": "mods/my-status/icons/claude.svg",
  codex: "mods/my-status/icons/codex.svg",
  antigravity: "mods/my-status/icons/antigravity.svg",
  cursor: "icons/cursor.svg",
  grok: "icons/grok.svg",
  kimi: "mods/my-status/icons/kimi.svg",
  muse: "icons/muse.svg",
};
const SHELL = {
  provider: null,
  displayName: "Shell",
  accountLabel: null,
  planName: null,
};
const pct = (n) => `${Math.round(n * 10) / 10}%`;
const usedOf = (e) => e.budgetUsed ?? e.fallbackWindow?.[1] ?? null;
// brim's picker columns: budget, 5-hour window, pace, time to reset.
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
// brim's bar colors: under 10% left is critical, under 30% low.
function pressure(e, t) {
  const used = usedOf(e);
  return used == null || used <= 70
    ? t.done
    : used <= 90
      ? t.working
      : t.blocked;
}
function providerIcon(e, t, faded) {
  const color = faded ? t.dim : t.muted;
  if (!e.provider)
    return svg("mods/workspace-chrome/terminal.svg")
      .size(16)
      .flex_none()
      .text_color(color);
  if (ICON[e.provider])
    return svg(ICON[e.provider]).size(16).flex_none().text_color(color);
  return div()
    .size(16)
    .flex_none()
    .rounded(4)
    .bg(t.border)
    .text_size(10)
    .text_color(color)
    .flex()
    .items_center()
    .justify_center()
    .child(e.displayName.slice(0, 1));
}

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Checkouts go to <ROOT>/<repo>/<branch, slashes as dashes>.
const ROOT = (home) => `${home}/.herdr/worktrees`;
// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const slug = (branch) =>
  branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600
    ? `${Math.max(1, Math.round(d / 60))}m`
    : d < 86400
      ? `${Math.round(d / 3600)}h`
      : d < 86400 * 60
        ? `${Math.round(d / 86400)}d`
        : `${Math.round(d / 86400 / 30)}mo`;
};

// Every checkout of a repo (`git worktree list`), the main one first, then
// the most recently committed: { path, branch, main, at }.
async function checkouts(repo, on) {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(
    repo.main,
    [
      "for-each-ref",
      "--format=%(refname:short)%09%(committerdate:unix)",
      "refs/heads",
    ],
    on,
  );
  const when = new Map(
    refs.out
      .split("\n")
      .map((l) => l.split("\t"))
      .map(([b, at]) => [b, Number(at) || 0]),
  );
  const out = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable")))
      continue;
    const branch =
      lines
        .find((l) => l.startsWith("branch "))
        ?.slice(7)
        .replace(/^refs\/heads\//, "") ?? null;
    out.push({
      path,
      branch,
      main: out.length === 0,
      at: branch ? (when.get(branch) ?? 0) : 0,
    });
  }
  return out.sort((a, b) => b.main - a.main || b.at - a.at);
}

// The space showing a checkout: its first terminal is in it (the deepest checkout wins).
function spaceOf(path, all, on, spaceList, paneList) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  return spaceList.find(
    (s) =>
      (s.machine ?? null) === (on ?? null) &&
      (() => {
        const at = place(s, paneList)?.replace(/\\/g, "/");
        if (!at || !inside(at, path)) return false;
        return !all.some(
          (c) =>
            c.path !== path &&
            c.path.length > path.length &&
            inside(at, c.path),
        );
      })(),
  );
}

async function git(cwd, args, on) {
  const r = await exec("git", args, { cwd, on });
  return {
    ok: r.code === 0,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? r.stdout ?? "").trim(),
  };
}

// The submodule repos git keeps for a checkout (nested ones too, checked out
// or not): { name, dir, pinned }. `config` is the args that read its
// .gitmodules; `pinned` is the commit its parent records ("" if none).
async function modules(gitDir, config, on, out = [], parent = "") {
  const keys = await git(
    gitDir,
    [
      "--git-dir",
      gitDir,
      "config",
      ...config,
      "-z",
      "--get-regexp",
      "^submodule\\..*\\.path$",
    ],
    on,
  );
  if (!keys.ok) return out; // no .gitmodules, or no submodules in it
  // -z: "key\nvalue" records ended by NUL, so names and paths may hold spaces.
  for (const record of keys.out.split("\0").filter(Boolean)) {
    const at = record.indexOf("\n");
    const name = record.slice("submodule.".length, at - ".path".length);
    const dir = `${gitDir}/modules/${name}`;
    if (
      !(await git(gitDir, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok
    )
      continue; // never checked out
    const pinned = await git(
      gitDir,
      ["--git-dir", gitDir, "rev-parse", `HEAD:${record.slice(at + 1)}`],
      on,
    );
    // Names are only unique within their parent: nested ones carry its name.
    out.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
    if (
      (
        await git(
          gitDir,
          ["--git-dir", dir, "cat-file", "-e", "HEAD:.gitmodules"],
          on,
        )
      ).ok
    )
      await modules(
        dir,
        ["--blob", "HEAD:.gitmodules"],
        on,
        out,
        `${parent + name}/`,
      );
  }
  return out;
}

// The worktree's submodules, and the names of those with commits that exist
// nowhere else: not on a remote, and not the commit the parent pins (git
// fetches that by hash, so it is often on no remote branch here).
async function submodules(top, on) {
  const gitDir = await git(top, ["rev-parse", "--absolute-git-dir"], on);
  if (!gitDir.ok) throw new Error(gitDir.err || "git rev-parse failed.");
  const mods = await modules(gitDir.out, ["--file", `${top}/.gitmodules`], on);
  const unpushed = [];
  for (const m of mods) {
    const local = await git(
      gitDir.out,
      [
        "--git-dir",
        m.dir,
        "rev-list",
        "-n1",
        "--all",
        "--not",
        "--remotes",
        ...(m.pinned ? [m.pinned] : []),
      ],
      on,
    );
    if (!local.ok)
      throw new Error(local.err || `Couldn't check submodule ${m.name}.`);
    if (local.out) unpushed.push(m.name);
  }
  return { mods, unpushed };
}

// The repo a folder belongs to: its main checkout and name, and whether
// the folder is itself a linked worktree. null outside git.
async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(
    folder,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    on,
  );
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git")
    ? common.out.slice(0, -5)
    : common.out;
  return {
    top: top.out,
    main,
    name: main.split("/").pop(),
    linked: main !== top.out,
  };
}

export default class Worktree extends View {
  init(_props, cx) {
    this.on = this.space()?.machine;
    this.userHome = this.on ? null : home();
    this.opening = props()?.action === "open";
    // New without a given branch: the agent's first message, which names it.
    this.messaging = props()?.action === "new" && !props()?.branch;
    this.text = props()?.branch ?? "";
    this.choice = {}; // provider -> { mode, model, effort }, null = its default
    this.catalogs = {}; // provider -> { models, error } once read
    this.choosing = null; // "mode" | "model" | "effort" while its list shows
    this.optionAt = 0;
    this.list = undefined; // open: the checkouts, once read
    this.at = 0;
    this.input = this.messaging
      ? TextareaState.new({ placeholder: "First message for the agent" })
      : InputState.new({ value: this.text, placeholder: "filter worktrees" });
    if (this.messaging) this.input.set_auto_grow(3, 8);
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      this.error = "";
      this.at = 0;
      cx.notify();
    });
    // Enter in the filter opens the highlighted checkout; only New and Remove
    // run work(). Shift-Enter in the message is a new line.
    this.input.on("submit", (e, cx) => {
      if (this.opening) this.open(this.shown()[this.at]);
      else if (e?.shift) return;
      else if (this.choosing) this.chooseAt(this.optionAt, cx);
      else this.go(cx);
    });
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => {
      this.inputFocused = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.inputFocused = false;
      cx.notify();
    });
    if (props()?.action !== "remove") {
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    }
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in git
    this.dirty = false;
    this.unpushed = [];
    this.handle = cx.focus_handle();
    if (props()?.action === "remove") this.handle.focus();
    // New without a given argv: the agents to pick from, once Brim answers.
    this.picking = props()?.action === "new" && !props()?.argv;
    this.agents = undefined; // { choices, ranked, other, unavailable (counts) } once read
    this.pick = 0;
    if (this.picking)
      cx.spawn(async (cx) => {
        try {
          const r = await exec("brim", ["--json"]);
          if (r.code !== 0)
            throw new Error(r.stderr.trim() || `brim --json exited ${r.code}.`);
          const b = JSON.parse(r.stdout);
          this.agents = {
            choices: [...b.ranked, ...b.other, ...b.unavailable, SHELL],
            ranked: b.ranked.length,
            other: b.other.length,
            unavailable: b.unavailable.length,
          };
          this.loadCatalog(this.provider(), cx);
        } catch (error) {
          this.agents = {
            choices: [SHELL],
            ranked: 0,
            other: 0,
            unavailable: 0,
            error: String(error),
          };
        }
        cx.notify();
      });
    cx.spawn(async (cx) => {
      try {
        if (this.on) {
          let result;
          try {
            result = await exec("sh", ["-c", 'printf %s "$HOME"'], {
              on: this.on,
            });
          } catch {}
          if (!result || result.code !== 0 || !result.stdout.trim())
            result = await exec(
              "powershell.exe",
              ["-NoProfile", "-Command", "[Console]::Write($HOME)"],
              { on: this.on },
            );
          if (result.code !== 0 || !result.stdout.trim())
            throw new Error("Could not find the remote home folder.");
          this.userHome = result.stdout.trim().replace(/\\/g, "/");
        }
        this.folder = props()?.folder || place(this.space()) || this.userHome;
        // The repo is set last: Enter does nothing until the warnings it consents to are known.
        const repo = await repoOf(this.folder, this.on);
        if (repo && props().action === "remove") {
          this.dirty =
            (
              await git(
                repo.top,
                [
                  "--no-optional-locks",
                  "-c",
                  "core.fsmonitor=false",
                  "status",
                  "--porcelain",
                ],
                this.on,
              )
            ).out !== "";
          this.unpushed = (await submodules(repo.top, this.on)).unpushed;
        }
        if (repo && this.opening) this.list = await checkouts(repo, this.on);
        this.repo = repo;
        // Model lists are read on the space's machine, once its home is known.
        this.loadCatalog(this.provider(), cx);
        cx.notify();
        if (props().branch) await this.work(cx);
      } catch (error) {
        this.repo = null;
        this.error = String(error);
        cx.notify();
      }
    });
  }

  space() {
    const p = props() ?? {};
    return (
      spaces().find((s) => s.id === p.space) ??
      (p.folder
        ? { folder: p.folder, machine: p.machine ?? null, name: "" }
        : undefined)
    );
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(cx) {
    if (this.busy || !this.repo) return;
    if (this.messaging) {
      this.error = this.startInBackground();
      if (!this.error) this.close();
      cx.notify();
      return;
    }
    cx.spawn(async (cx) => this.work(cx));
  }

  async work(cx) {
    if (this.busy || !this.repo) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try {
      this.error =
        props().action === "remove" ? await this.remove() : await this.create();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  // The highlighted agent's Brim provider id, or null for Shell.
  provider() {
    return this.picking
      ? (this.agents?.choices[this.pick]?.provider ?? null)
      : null;
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

  // Hands the work to the detached worker; "" once it is started.
  startInBackground() {
    const message = this.text.trim();
    if (!message) return "Type a first message.";
    if (this.picking && !this.agents)
      return "Still asking Brim for the agents.";
    const provider = this.provider();
    let args = [];
    let safe = false;
    try {
      if (provider)
        ({ args, safe } = agentArgs(provider, this.choiceFor(provider)));
    } catch (error) {
      return error.message;
    }
    const request = {
      message,
      provider,
      machine: this.on ?? null,
      repoMain: this.repo.main,
      repoTop: this.repo.top,
      root: `${ROOT(this.userHome)}/${this.repo.name}`,
      agentArgs: args,
      safe,
      // A caller's own program and tab, when it gave them instead of a pick.
      argv: this.picking ? null : (props().argv ?? null),
      tab: props().tab ?? null,
    };
    // The dialog closes now and its tasks with it; a process it started keeps
    // running. Results: ~/.local/state/herdr-worktree/events.jsonl, the unified
    // log, and a notification when it fails.
    exec("sh", [
      "-c",
      'nohup "$0" "$1" >/dev/null 2>&1 &',
      `${home()}/bin/herdr-new-worktree`,
      JSON.stringify(request),
    ]);
    return "";
  }

  // The agent's model list, cached, then refreshed once per window.
  loadCatalog(provider, cx) {
    // The remote home arrives later; init loads again once it has.
    if (!provider || !CATALOGS[provider] || !this.userHome) return;
    if (this.catalogs[provider]?.fresh) return;
    const key = `catalog:${this.on ?? "local"}:${provider}`;
    const cached = stored(key);
    this.catalogs[provider] = {
      models: cached ?? [],
      fresh: true,
      error: null,
    };
    cx.spawn(async (cx) => {
      try {
        const models = await CATALOGS[provider](this.on ?? null, this.userHome);
        this.catalogs[provider] = { models, fresh: true, error: null };
        store(key, models);
      } catch (error) {
        this.catalogs[provider] = {
          models: cached ?? [],
          fresh: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      cx.notify();
    });
  }

  // The choices for one control: [{ id, label }], the default first.
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
    const caps = capabilities(provider);
    return kind === "mode"
      ? caps.modes.length > 0
      : kind === "model"
        ? // Only agents whose model list can be read get a Model control.
          Boolean(caps.model && CATALOGS[provider])
        : Boolean(caps.effort);
  }

  choose(kind, id, provider, cx) {
    const choice = this.choiceFor(provider);
    choice[kind] = id;
    // An effort the new model doesn't take goes back to its default.
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
    const provider = this.provider();
    const option = this.options(this.choosing, provider)[i];
    if (option) this.choose(this.choosing, option.id, provider, cx);
  }

  // Alt-M / Alt-O / Alt-E step a control without opening its list.
  cycle(kind, step, cx) {
    const provider = this.provider();
    if (!provider || !this.offers(kind, provider)) return;
    this.loadCatalog(provider, cx);
    const list = this.options(kind, provider);
    const now = list.findIndex((o) => o.id === this.choiceFor(provider)[kind]);
    const next = list[(Math.max(0, now) + step + list.length) % list.length];
    this.choose(kind, next.id, provider, cx);
  }

  // A given { branch }: checked out when it exists, else started from here.
  async create() {
    // The branch is used as written; check-ref-format rejects an invalid one.
    const branch = this.text.trim();
    if (!branch) return "Type a branch name.";
    if (this.picking && !this.agents)
      return "Still asking Brim for the agents.";
    const provider = this.provider();
    const exists = (
      await git(
        this.repo.main,
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        this.on,
      )
    ).ok;
    const valid = await git(
      this.repo.main,
      ["check-ref-format", "--branch", branch],
      this.on,
    );
    if (!valid.ok) return valid.err || `git rejects the branch ${branch}.`;
    const path = `${ROOT(this.userHome)}/${this.repo.name}/${slug(branch)}`;
    const add = exists
      ? ["worktree", "add", path, branch]
      : ["worktree", "add", "-b", branch, path, "HEAD"];
    const r = await git(this.repo.top, add, this.on);
    if (!r.ok) return r.err || "git worktree add failed.";
    const p = props();
    let argv = p.argv;
    if (provider) {
      const { args, safe } = agentArgs(provider, this.choiceFor(provider));
      argv = [
        ...(safe ? ["env", "AGENT_SAFE=1"] : []),
        "brim",
        "--provider",
        provider,
        "--",
        ...args,
      ];
    }
    // Leave spaces unnamed so they follow the checkout folder and nest under the repo.
    run("space.new", { folder: path, machine: this.on, tab: p.tab, argv });
    return "";
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter(
      (c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f),
    );
  }

  open(c) {
    if (!c || this.opened) return;
    this.opened = true;
    this.close();
    const s = spaceOf(c.path, this.list, this.on, spaces(), panes());
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: c.path, machine: this.on });
  }

  async remove() {
    const s = this.space();
    const status = await git(
      this.repo.top,
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "status",
        "--porcelain",
      ],
      this.on,
    );
    if (!status.ok) return status.err || "git status failed.";
    // git refuses a worktree with submodules unless forced, because their
    // history goes with it. The popup already showed what's at risk; only
    // risk that appeared since it opened gets one more warning.
    const { mods, unpushed } = await submodules(this.repo.top, this.on);
    const changed =
      (status.out && !this.dirty) ||
      unpushed.some((name) => !this.unpushed.includes(name));
    this.dirty ||= status.out !== "";
    this.unpushed = [...new Set([...this.unpushed, ...unpushed])];
    if (changed)
      return "It changed since this opened. Enter again removes it anyway.";
    // Terminals first: a shell sitting in the folder keeps it busy on Windows.
    run("space.close", { id: s.id, confirmed: true });
    const force = this.dirty || mods.length > 0;
    const r = await git(
      this.repo.main,
      ["worktree", "remove", ...(force ? ["--force"] : []), this.repo.top],
      this.on,
    );
    return r.ok ? "" : r.err || "git worktree remove failed.";
  }

  key(e, cx) {
    // Escape leaves an open option list first, then the dialog.
    if (e.key === "escape" && this.choosing) {
      this.choosing = null;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "escape") return this.close();
    if (this.opening) {
      const n = this.shown().length;
      // With the filter focused, its submit handles Enter.
      if (e.key === "enter" && !this.inputFocused)
        this.open(this.shown()[this.at]);
      else if ((e.key === "down" || e.key === "up") && n)
        this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && props()?.action === "remove") return this.go(cx);
    const shortcut = {
      "alt-m": ["mode", 1],
      "alt-shift-m": ["mode", -1],
      "alt-o": ["model", 1],
      "alt-shift-o": ["model", -1],
      "alt-e": ["effort", 1],
      "alt-shift-e": ["effort", -1],
    }[e.keystroke];
    if (this.picking && shortcut) {
      this.cycle(shortcut[0], shortcut[1], cx);
      return cx.stop_propagation();
    }
    const vertical = e.key === "down" || e.key === "up";
    if (this.choosing && vertical) {
      const n = this.options(this.choosing, this.provider()).length;
      this.optionAt = (this.optionAt + (e.key === "down" ? 1 : n - 1)) % n;
      cx.stop_propagation();
      return cx.notify();
    }
    const n = this.agents?.choices.length ?? 0;
    if (this.picking && n && vertical) {
      this.pick = (this.pick + (e.key === "down" ? 1 : n - 1)) % n;
      this.loadCatalog(this.provider(), cx);
      cx.stop_propagation();
      cx.notify();
    }
  }

  // Mode, model and effort for the highlighted agent: each a chip that opens
  // its list; only the ones the agent takes are shown.
  renderChoices(t) {
    const provider = this.provider();
    if (!provider) return div();
    const choice = this.choiceFor(provider);
    const kinds = ["mode", "model", "effort"].filter((k) =>
      this.offers(k, provider),
    );
    const chip = (kind) => {
      const label =
        this.options(kind, provider).find((o) => o.id === choice[kind])
          ?.label ?? choice[kind];
      const open = this.choosing === kind;
      return h_flex()
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
        );
    };
    return h_flex().flex_none().gap(6).items_center().children(kinds.map(chip));
  }

  // The open control's choices, in place of the agent list.
  renderOptions(t) {
    const provider = this.provider();
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

  // The agent list under the branch name: brim's sections, the pick highlighted.
  renderAgents(t) {
    const a = this.agents;
    if (!a) return div().text_color(t.dim).child("Asking Brim…");
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
    // Unavailable ones (signed out, stale) start too; their row says why Brim can't rank them.
    const row = (e, i) => {
      const on = i === this.pick;
      const off = e.available === false;
      const used = off ? null : usedOf(e);
      return h_flex()
        .id(`agent-${e.provider ?? "shell"}`)
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
          this.loadCatalog(this.provider(), cx);
          cx.notify();
        })
        .child(providerIcon(e, t, off && !on))
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
                  // The plan as the provider reports it; the account (Grok's email) on hover.
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
        .when(Boolean(e.provider) && !off, (el) =>
          el.child(
            div()
              .flex_none()
              .w(230)
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
    const rows = [heading("Sorted by usage")];
    a.choices.forEach((e, i) => {
      if (a.other && i === a.ranked) rows.push(heading("Other windows"));
      if (a.unavailable && i === a.ranked + a.other)
        rows.push(heading("Unavailable"));
      if (!e.provider)
        rows.push(div().flex_none().mx(10).my(4).h(1).bg(t.border));
      rows.push(row(e, i));
    });
    if (a.error)
      rows.push(
        div()
          .flex_none()
          .px(10)
          .py(4)
          .text_size(11.5)
          .text_color(t.blocked)
          .child(`Brim: ${a.error}`),
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

  renderOpen(t) {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const spaceList = spaces();
    const paneList = panes();
    const row = (c, i) => {
      const on = i === this.at;
      const there = spaceOf(c.path, all, this.on, spaceList, paneList);
      return v_flex()
        .id(`wt-${i}`)
        .flex_none()
        .h(44)
        .px(10)
        .justify_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => this.open(c))
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(
              div()
                .flex_1()
                .min_w(0)
                .truncate()
                .text_color(t.foreground)
                .child(c.branch ?? "detached"),
            )
            .when(c.main, (el) =>
              el.child(
                div()
                  .flex_none()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("main checkout"),
              ),
            )
            .when(Boolean(there), (el) =>
              el.child(
                div()
                  .flex_none()
                  .text_size(11)
                  .text_color(t.accent)
                  .child("open"),
              ),
            )
            .when(!there && c.at > 0, (el) =>
              el.child(
                div()
                  .flex_none()
                  .text_size(11)
                  .text_color(t.dim)
                  .child(ago(c.at)),
              ),
            ),
        )
        .child(
          div()
            .truncate()
            .text_size(11.5)
            .text_color(t.dim)
            .child(tilde(c.path, this.userHome ?? "")),
        );
    };
    const count =
      rows.length === all.length
        ? `${all.length} checkouts`
        : `${rows.length}/${all.length} checkouts`;
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex()
          .child(
            div()
              .flex_1()
              .font_semibold()
              .text_color(t.foreground)
              .child(`Open worktree${r ? ` of ${r.name}` : ""}`),
          )
          .child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child(r ? count : ""),
          ),
      )
      .when(r === undefined || (r && this.list === undefined), (el) =>
        el.child(div().text_color(t.muted).child("\u2026")),
      )
      .when(r === null, (el) =>
        el.child(
          div()
            .text_color(t.muted)
            .child(
              `${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a git repository.`,
            ),
        ),
      )
      .when(Boolean(r && this.list), (el) =>
        el
          .child(
            Input.new(this.input)
              .h(32)
              .px(10)
              .items_center()
              .rounded(6)
              .border(1)
              .border_color(this.inputFocused ? t.accent : t.input)
              .bg(t.background)
              .text_color(t.foreground),
          )
          .child(
            div()
              .relative()
              .flex_1()
              .min_h(0)
              .child(
                v_flex()
                  .id("wt-list")
                  .size_full()
                  .overflow_y_scroll()
                  .children(rows.map(row))
                  .when(rows.length === 0, (el) =>
                    el.child(
                      div()
                        .p(10)
                        .text_color(t.dim)
                        .child("No matching worktrees."),
                    ),
                  ),
              )
              .child(Scrollbar.vertical("wt-list").absolute().inset_0()),
          ),
      )
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .child("\u2191\u2193 choose \u00b7 \u21b5 open \u00b7 esc close"),
      );
  }

  render(cx) {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    const remove = props()?.action === "remove";
    const s = this.space();
    const r = this.repo;
    const title = remove
      ? `Remove worktree ${s?.name ?? ""}?`
      : `New worktree${r ? ` of ${r.name}` : ""}`;
    const detail =
      r === undefined
        ? "…"
        : r === null
          ? `${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a git repository.`
          : remove
            ? !r.linked
              ? "This is the repository's main checkout, not a worktree."
              : `Closes the space and deletes ${tilde(r.top, this.userHome)}. The branch stays.`
            : this.messaging
              ? `A new space on a checkout in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/, on a new branch from here. The branch and tab are named from the message, which the agent starts with.`
              : `A new space on a checkout in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/. A branch that exists is checked out; a new one starts from here.`;
    const blocked = !r || (remove && !r.linked);
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(remove && this.dirty, (el) =>
        el.child(
          div()
            .text_color(t.blocked)
            .child("It has uncommitted changes: they will be lost."),
        ),
      )
      .when(remove && this.unpushed.length > 0, (el) =>
        el.child(
          div()
            .text_color(t.blocked)
            .child(
              `Submodule ${this.unpushed.join(", ")} has commits that aren't pushed anywhere: they will be lost.`,
            ),
        ),
      )
      .when(!remove && !blocked && this.messaging, (el) =>
        el.child(
          Textarea.new(this.input)
            .px(10)
            .py(6)
            .rounded(6)
            .border(1)
            .border_color(this.inputFocused ? t.accent : t.input)
            .bg(t.background)
            .text_color(t.foreground),
        ),
      )
      .when(!remove && !blocked && !this.messaging, (el) =>
        el.child(
          Input.new(this.input)
            .h(32)
            .px(10)
            .items_center()
            .rounded(6)
            .border(1)
            .border_color(this.inputFocused ? t.accent : t.input)
            .bg(t.background)
            .text_color(t.foreground),
        ),
      )
      .when(this.picking && !blocked && !remove, (el) =>
        el.child(this.renderChoices(t)),
      )
      .when(Boolean(this.error), (el) =>
        el.child(div().text_color(t.blocked).child(this.error)),
      )
      .when(this.picking && !blocked && Boolean(this.choosing), (el) =>
        el.child(this.renderOptions(t)),
      )
      .when(this.picking && !blocked && !this.choosing, (el) =>
        el.child(this.renderAgents(t)),
      )
      .when(!(this.picking && !blocked), (el) => el.child(div().flex_1()))
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .child(
            this.busy
              ? "working…"
              : blocked
                ? "esc close"
                : remove
                  ? "↵ remove · esc cancel"
                  : this.picking
                    ? this.messaging
                      ? this.choosing
                        ? "↑↓ choose · ↵ pick · esc back"
                        : "↑↓ agent · ⌥M ⌥O ⌥E mode, model, effort · ↵ start · ⇧↵ new line · esc cancel"
                      : "↑↓ agent · ↵ create · esc cancel"
                    : "↵ create · esc cancel",
          ),
      );
  }
}
