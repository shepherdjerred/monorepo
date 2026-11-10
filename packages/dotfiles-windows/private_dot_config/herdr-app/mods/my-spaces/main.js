// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  spaces,
  machines,
  panes,
  terminals,
  run,
  openOverlay,
  exec,
  hc,
  home,
  readTextFile,
  theme,
  shared,
  setShared,
  watchFolder,
  window,
  layout,
} from "herdr";

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

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
// While "hide.exhausted" isn't false (my-agents toggles it and polls Brim into
// "brim.exhausted"): a space whose chats are all at their provider's limit is left
// out, unless it's the one shown. An agent Brim doesn't know keeps its space.
// Brim's provider ids, by the app an agent reports, its program's key, or, for a
// terminal that reports neither (Windows codex), the programs it was started with.
const PROVIDER = {
  "claude-code": "claude-code",
  claude: "claude-code",
  codex: "codex",
  agy: "antigravity",
  gemini: "antigravity",
  cursor: "cursor",
  "cursor-agent": "cursor",
  grok: "grok",
  "grok-build": "grok",
  kimi: "kimi",
  muse: "muse",
};
const fromArgv = (argv) =>
  argv
    .flatMap((a) => a.split(/[\s'"]+/))
    .map((w) =>
      w
        .split(/[\\/]/)
        .pop()
        .replace(/\.exe$/i, "")
        .toLowerCase(),
    )
    .find((w) => PROVIDER[w]);
function allAtLimit(s, ps, argvOf, limits) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const provider = (p) =>
    PROVIDER[p.app] ??
    PROVIDER[p.program?.key] ??
    PROVIDER[fromArgv(argvOf.get(p.terminal) ?? [])];
  const mine = ps.filter(
    (p) => tabs.has(p.tab) && (p.program?.agent || provider(p)),
  );
  return mine.length > 0 && mine.every((p) => limits[provider(p)]);
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const folderBase = (folder) => {
  const parts = String(folder ?? "")
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
};

// Display names only. hc machine names and addresses stay as they are.
const MACHINE_TITLES = {
  "jerreds-macbook-pro": "MacBook",
  "jerred-desktop": "Windows",
  desktop: "Windows",
  "mac-mini": "Karpathy",
  karpathy: "Karpathy",
  jobs: "Jobs",
  "jerreds-mac-mini": "Jobs",
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
  if (name == null && platform === "windows") return "Windows";
  return name ?? "This computer";
}

// Same glyphs as the agents list. An unlisted machine keeps the generic server.
const DEVICE_ICONS = {
  karpathy: "mac-mini-top",
  "mac-mini": "mac-mini-top",
  jobs: "mac-mini-top",
  "jerreds-mac-mini": "mac-mini-top",
  desktop: "windows",
  "jerred-desktop": "windows",
  "jerreds-macbook-pro": "laptop",
};

function machineIcon(name, info, platform) {
  if (name == null) return platform === "windows" ? "windows" : "laptop";
  for (const key of [name, info?.target, info?.host]) {
    const icon = DEVICE_ICONS[hostKey(key)];
    if (icon) return icon;
  }
  return null;
}

function machineIconPath(name, info, platform) {
  const icon = machineIcon(name, info, platform);
  // The Windows layout keeps its glyphs in agents-filter; this Mac's are in my-agents.
  const dir = platform === "windows" ? "mods/agents-filter" : "mods/my-agents";
  return icon
    ? `${dir}/${icon}.svg`
    : `mods/workspace-chrome/${name ? "server" : "monitor"}.svg`;
}

// A named space keeps its name. Otherwise a generated tab title, never the
// branch, the checkout folder, or a positional name like "1".
function spaceLabel(w) {
  if (w.named) return w.name;
  const folder = folderBase(w.folder);
  const branch = w.branch ?? "";
  const tab = (w.tabs ?? []).find((item) => {
    if (!item.named || /^\d+$/.test(item.name ?? "")) return false;
    const title = item.name.trim().toLowerCase();
    if (!title) return false;
    if (folder && title === folder.toLowerCase()) return false;
    if (branch && title === branch.toLowerCase()) return false;
    return true;
  });
  return tab?.name || w.name;
}

const STEP_LABEL = {
  naming: "Naming",
  branch: "Choosing a branch",
  worktree: "Creating checkout",
  space: "Opening",
  message: "Starting the agent",
};
const activeDir = () => `${home()}/.local/state/herdr-worktree/active`;
const awakeDir = () => `${home()}/.local/state/herdr-caffeinate`;
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = {
  ansi6: "#22a99a",
  ansi3: "#e3814f",
  ansi4: "#5b8def",
  ansi5: "#8b7cf6",
  ansi2: "#3fae6a",
  ansi1: "#d9649a",
};

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.hostName = null;
    this.jobs = [];
    this.awake = false;
    this.folded = new Set(
      JSON.parse(localStorage.getItem("machines.folded") ?? "[]"),
    );
    this.refreshMachines(cx);
    this.watchJobs(cx);
    cx.timer.every(15000, (cx) => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at))
      if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] =
        p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane])
        this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false)
        for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (
          asks &&
          !this.folded.has(JSON.parse(k)[0]) &&
          now - (this.checked[k] ?? 0) > FALLBACK
        )
          due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [
      key,
      ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : []),
    ];
  }

  refreshMachines(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0)
          this.machines = (JSON.parse(r.stdout).machines ?? []).filter(
            (m) => !m.temporary,
          );
      } catch {}
      if (this.hostName == null) {
        try {
          const host = await exec("hostname");
          const name = host.stdout.trim().replace(/\.local$/, "");
          if (host.code === 0 && name) this.hostName = name;
        } catch {}
      }
      try {
        await this.loadJobs();
      } catch {}
      if (this.caffeinateHere(null)) {
        try {
          await this.readAwake();
        } catch {}
      }
      cx.notify();
    });
  }

  // Runs the dialog started, on this computer, until the worker deletes them.
  async loadJobs() {
    const listed = await exec("ls", ["-1", activeDir()]);
    const jobs = [];
    if (listed.code !== 0) {
      this.jobs = [];
      return;
    }
    for (const name of listed.stdout.split("\n")) {
      if (!name.endsWith(".json")) continue;
      const text = await readTextFile(`${activeDir()}/${name}`);
      if (!text) continue;
      let job;
      try {
        job = JSON.parse(text);
      } catch {
        continue;
      }
      if (!job || typeof job.pid !== "number" || typeof job.repo !== "string")
        continue;
      const live = await exec("kill", ["-0", String(job.pid)]);
      if (live.code !== 0) continue;
      jobs.push({ ...job, id: name.slice(0, -".json".length) });
    }
    this.jobs = jobs;
  }

  watchJobs(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          await this.loadJobs();
          cx.notify();
          await watchFolder(activeDir());
        } catch {
          // The folder appears with the first run. Don't spin until then.
          await exec("sleep", ["2"]);
        }
      }
    });
  }

  caffeinateHere(m) {
    return (
      m == null &&
      window().platform === "macos" &&
      machineTitle(null, null, this.hostName, window().platform) === "MacBook"
    );
  }

  // `ps -o comm=` has to run in a shell: the trailing "=" is the header
  // suppressor, and it has to reach ps intact.
  async caffeinateComm(pid) {
    const ps = await exec("sh", ["-c", 'ps -p "$0" -o comm=', String(pid)]);
    return ps.code === 0 ? ps.stdout.trim() : "";
  }

  async readAwake() {
    const text = await readTextFile(`${awakeDir()}/pid`);
    const pid = Number.parseInt(String(text ?? "").trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      this.awake = false;
      return;
    }
    this.awake = /(^|\/)caffeinate$/.test(await this.caffeinateComm(pid));
  }

  async startAwake() {
    await this.readAwake();
    if (this.awake) return;
    const dir = awakeDir();
    // setsid, then exec, so the pid file is caffeinate itself and the shell
    // exits. A backgrounded nohup records the wrapper, which is not caffeinate.
    await exec("sh", [
      "-c",
      'mkdir -p "$0" && chmod 700 "$0"; perl -MPOSIX -e \'POSIX::setsid(); exec "caffeinate", "-i" or die\' >/dev/null 2>&1 & echo $! > "$0/pid"; chmod 600 "$0/pid"',
      dir,
    ]);
  }

  async stopAwake() {
    const pidfile = `${awakeDir()}/pid`;
    const text = await readTextFile(pidfile);
    const pid = Number.parseInt(String(text ?? "").trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      if (/(^|\/)caffeinate$/.test(await this.caffeinateComm(pid)))
        await exec("kill", [String(pid)]);
    }
    await exec("rm", ["-f", pidfile]);
  }

  toggleAwake(cx) {
    cx.spawn(async (cx) => {
      try {
        await this.readAwake();
        if (this.awake) await this.stopAwake();
        else await this.startAwake();
        await this.readAwake();
      } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(
        Object.values(this.git)
          .filter(Boolean)
          .map((g) => JSON.parse(g.repo))
          .filter(([on]) => !on)
          .map(([, repo]) => repo),
      );
      for (const repo of this.watching)
        if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec(
        "git",
        [
          "--no-optional-locks",
          "-c",
          "core.fsmonitor=false",
          "status",
          "--porcelain=v2",
          "--branch",
        ],
        { cwd, on },
      );
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        on,
      });
      const common = await exec(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd, on },
      );
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git")
        ? base(repo.slice(0, -5))
        : base(repo).replace(/\.git$/, "");
      const info = {
        name,
        branch: null,
        ahead: 0,
        behind: 0,
        repo: JSON.stringify([on, repo]),
        linked: repo !== `${top.stdout.trim()}/.git`,
      };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo))
            this.refreshGit(
              Object.keys(this.git).filter((k) => this.git[k]?.repo === mine),
              cx,
            );
        }
      } catch {
        this.watching.delete(repo);
      }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({
      mod: "my-menu",
      kind: "popup",
      width: 200,
      height: 260,
      props: { tab: "space", target: { id: w.id } },
    });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(),
      ps = panes();
    const ready = (w) =>
      this.shown.has(w.id) ||
      where(w, ps) in this.git ||
      Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp)
      if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const limits =
      shared("hide.exhausted") !== false
        ? (shared("brim.exhausted") ?? {})
        : {};
    const hiding = Object.keys(limits).length > 0;
    const argvOf = new Map(
      hiding ? terminals().map((k) => [k.address, k.argv ?? []]) : [],
    );
    const list = sp
      .map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }))
      .filter(
        (r) =>
          this.shown.has(r.w.id) &&
          !(hiding && !r.w.active && allAtLimit(r.w, ps, argvOf, limits)),
      );
    const mains = new Set(
      list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo),
    );
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) =>
        out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }),
      );
    }
    return out;
  }

  jobsFor(m) {
    return (this.jobs ?? []).filter((job) => (job.machine ?? null) === m);
  }

  // In-progress worktrees sit under their repo, or under the machine when that
  // group is not in the list yet. Hidden while the sidebar is collapsed.
  rowsWithJobs(rows, m, collapsed, t, draw) {
    if (collapsed) return rows.map(draw);
    const jobs = this.jobsFor(m);
    const matched = new Set();
    const drawn = [];
    for (const row of rows) {
      drawn.push(draw(row));
      if (row.tree || !row.g?.name) continue;
      for (const job of jobs) {
        if (job.repo !== row.g.name || matched.has(job.id)) continue;
        matched.add(job.id);
        drawn.push(this.jobRow(job, t));
      }
    }
    const loose = jobs
      .filter((job) => !matched.has(job.id))
      .map((job) => this.jobRow(job, t));
    return [...loose, ...drawn];
  }

  jobRow(job, t) {
    return h_flex()
      .id(`worktree-job-${job.id}`)
      .h(28)
      .flex_none()
      .px(8)
      .items_center()
      .child(
        h_flex()
          .pl(22)
          .gap(9)
          .flex_1()
          .min_w(0)
          .items_center()
          .child(
            svg("mods/workspace-chrome/spinner.svg")
              .size(13)
              .flex_none()
              .text_color(t.dim)
              .spin(900),
          )
          .child(
            div()
              .flex_shrink(0)
              .max_w(150)
              .truncate()
              .text_color(t.foreground)
              .child(job.title || "New worktree"),
          )
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(11.5)
              .text_color(t.dim)
              .child(STEP_LABEL[job.step] ?? ""),
          ),
      );
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [
      ...new Set([
        ...rows.map((r) => r.w.machine).filter(Boolean),
        ...this.machines.map((m) => m.name),
      ]),
    ].sort();
    const loading = (m) => {
      const layout = machines().find((k) => k.name === m)?.layout;
      return (
        layout === "loading" ||
        (!layout &&
          this.machines.some((k) => k.name === m && k.state === "connected")) ||
        spaces().some((s) => (s.machine ?? null) === m && !this.shown.has(s.id))
      );
    };
    const loadingRow = (m) =>
      div()
        .id(`machine-loading-${m ?? "local"}`)
        .h(28)
        .flex_none()
        .px(8)
        .text_size(12)
        .text_color(t.dim)
        .child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      const jobs = this.rowsWithJobs(rows, null, collapsed, t, draw);
      return loading(null) && !rows.length ? [loadingRow(null), ...jobs] : jobs;
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find((k) => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const head = h_flex()
        .id(`machine-${m ?? "local"}`)
        .h(26)
        .flex_none()
        .px(collapsed ? 2 : 8)
        .gap(7)
        .items_center()
        .text_size(11)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem(
            "machines.folded",
            JSON.stringify([...this.folded]),
          );
          cx.notify();
        })
        .child(
          svg(machineIconPath(m, machine, window().platform))
            .size(13)
            .flex_none()
            .text_color(t.dim),
        )
        .when(!collapsed, (el) =>
          el
            .child(
              div()
                .flex_1()
                .truncate()
                .child(
                  machineTitle(m, machine, this.hostName, window().platform),
                ),
            )
            .when(!connected, (el) =>
              el.child(
                div()
                  .flex_none()
                  .child((machine?.state ?? "asleep").replace(/_/g, " ")),
              ),
            )
            .when(connected && this.caffeinateHere(m), (el) =>
              el.child(
                h_flex()
                  .id("machine-awake")
                  .flex_none()
                  .gap(5)
                  .items_center()
                  .tooltip(
                    this.awake ? "Keeping this Mac awake" : "Allow sleep",
                  )
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    this.toggleAwake(cx);
                  })
                  .child(
                    div()
                      .text_color(this.awake ? t.accent : t.foreground)
                      .child(this.awake ? "Awake" : "Off"),
                  )
                  .child(
                    h_flex()
                      .w(22)
                      .h(12)
                      .rounded(6)
                      .px(2)
                      .items_center()
                      .flex_none()
                      .bg(this.awake ? t.accent : t.raised)
                      .when(this.awake, (track) => track.justify_end())
                      .child(
                        div()
                          .size(8)
                          .rounded(4)
                          .bg(this.awake ? t.accent_foreground : t.foreground),
                      ),
                  ),
              ),
            )
            .when(connected, (el) =>
              el.child(
                div()
                  .id(`machine-add-${m ?? "local"}`)
                  .flex_none()
                  .px(4)
                  .rounded(4)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    run("space.new", m ? { machine: m } : {});
                  })
                  .child("+"),
              ),
            )
            .child(
              div()
                .size(6)
                .rounded(3)
                .flex_none()
                .bg(connected ? t.ansi2 : t.dim),
            )
            .child(
              svg(
                `mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`,
              )
                .size(11)
                .flex_none(),
            ),
        );
      const empty = h_flex()
        .id(`machine-new-${m ?? "local"}`)
        .h(28)
        .flex_none()
        .px(8)
        .gap(7)
        .items_center()
        .rounded(7)
        .text_size(12)
        .text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", m ? { machine: m } : {}))
        .child(svg("mods/workspace-chrome/plus.svg").size(12))
        .when(!collapsed, (el) => el.child("New space there"));
      return [
        head,
        ...(folded
          ? []
          : mine.length
            ? this.rowsWithJobs(mine, m, collapsed, t, draw)
            : [
                ...this.rowsWithJobs([], m, collapsed, t, draw),
                loading(m) ? loadingRow(m) : empty,
              ]),
      ];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". `name` is
  // the checkout folder, so a titled space does not also print its branch.
  // master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) =>
        el.child(div().min_w(0).truncate().child(where)),
      )
      .when(g.ahead > 0, (el) =>
        el.child(
          div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`),
        ),
      )
      .when(g.behind > 0, (el) =>
        el.child(
          div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`),
        ),
      );
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const label = spaceLabel(w);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(
        this.pressed !== null && this.over === i && this.pressed !== i,
        (el) => el.border_t(2).border_color(t.accent),
      )
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i)
          run("space.move", { id: spaces()[from].id, index: i + 1 });
        else run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), (el) =>
            el
              .pl(22)
              .child(
                svg("mods/workspace-chrome/branch.svg")
                  .size(13)
                  .text_color(t.dim),
              ),
          )
          .when(!tree, (el) =>
            el.child(
              h_flex()
                .size(18)
                .flex_none()
                .rounded(5)
                .bg(fill)
                .items_center()
                .justify_center()
                .text_size(10.5)
                .font_bold()
                .text_color("#ffffff")
                .child([...label][0]?.toUpperCase() ?? "?"),
            ),
          )
          .child(
            div()
              .flex_shrink(0)
              .max_w(150)
              .truncate()
              .text_color(t.foreground)
              .child(label),
          )
          .child(
            g
              ? this.gitTail(g, tree, folderBase(w.folder) || w.name, t)
              : div().flex_1(),
          ),
      );
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(
        div()
          .text_color(w.active ? t.foreground : t.muted)
          .child(String(i + 1)),
      )
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map((p) => p.id));
    const kept = Object.fromEntries(
      Object.entries(shared("space.colors") ?? {}).filter(([id]) =>
        ids.has(id),
      ),
    );
    let changed =
      Object.keys(kept).length !==
      Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[p.id] = palette.reduce((best, c) =>
        uses(c) < uses(best) ? c : best,
      );
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .child(
        h_flex()
          .h(31)
          .pl(16)
          .pr(10)
          .items_center()
          .justify_between()
          .text_size(11.5)
          .text_color(t.dim)
          .when(!collapsed, (el) => el.child("Spaces"))
          .child(
            div()
              .id("space-new")
              .p(4)
              .rounded(5)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => run("space.new"))
              .child("+"),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .px(8)
          .pb(14)
          .overflow_y_scrollbar()
          .mode("always")
          .on_mouse_up("left", (_e, cx) => {
            this.pressed = null;
            cx.notify();
          })
          .children(this.grouped(t, collapsed)),
      );
  }
}
