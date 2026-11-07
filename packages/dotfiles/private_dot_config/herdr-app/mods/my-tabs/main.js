// The shipped tabs bar, plus browser-style Back/Forward through the tabs and
// spaces you have shown (‹ ›, or "my-tabs.back" / "my-tabs.forward" keys) and
// the shown space's name, bold, before its tabs.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  spaces,
  panes,
  run,
  openOverlay,
  theme,
  window,
  shared,
  layout,
  settings,
  nextCommand,
} from "herdr";

const HISTORY_MAX = 100;
// How long a Back/Forward jump may take to land before other changes count again.
const SETTLE_MS = 1500;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Visited { space, tab } places, oldest first; `at` is the one shown.
    this.history = [];
    this.at = -1;
    this.going = null; // { place, until } while a Back/Forward jump lands
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "back") this.step(-1);
        else if (command === "forward") this.step(1);
        cx.notify();
      }
    });
  }

  // Records the shown place, unless it is where a jump is going: a new place
  // after Back drops the forward entries, like a browser.
  track(space) {
    const tab = space?.tabs?.find((c) => c.active);
    if (!space || !tab) return;
    const place = { space: space.id, tab: tab.id };
    const same = (a, b) => a && b && a.space === b.space && a.tab === b.tab;
    if (this.going) {
      if (same(place, this.going.place)) {
        this.going = null;
        return;
      }
      if (Date.now() < this.going.until) return;
      this.going = null;
    }
    if (same(place, this.history[this.at])) return;
    this.history = [...this.history.slice(0, this.at + 1), place].slice(
      -HISTORY_MAX,
    );
    this.at = this.history.length - 1;
  }

  // A place still open: its space and tab both exist.
  exists(place) {
    return Boolean(
      spaces()
        .find((s) => s.id === place.space)
        ?.tabs?.some((c) => c.id === place.tab),
    );
  }

  // The nearest open place in that direction, or -1.
  target(direction) {
    for (
      let i = this.at + direction;
      i >= 0 && i < this.history.length;
      i += direction
    )
      if (this.exists(this.history[i])) return i;
    return -1;
  }

  step(direction) {
    const i = this.target(direction);
    if (i < 0) return;
    const place = this.history[i];
    this.at = i;
    this.going = { place, until: Date.now() + SETTLE_MS };
    run("space.select", { id: place.space });
    run("tab.select", { id: place.tab });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : (body?.active ?? null);
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id;
      this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null,
          want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) {
            run("layout.select", { stack: "panel-body", child: want });
            run("layout.show", { id: "panel" });
          } else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find((p) => p.active);
    this.track(space);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) =>
      div()
        .id(id)
        .size(26)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click(action)
        .child(label);
    const item = (c, i) => {
      const program =
        panes().find((p) => p.tab === c.id && p.program?.agent)?.program ??
        panes().find((p) => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name)
        ? (program?.name ?? "Terminal")
        : c.name;
      return h_flex()
        .id(`tab-${c.id}`)
        .h(29)
        .px(10)
        .gap(7)
        .rounded(7)
        .items_center()
        .flex_none()
        .text_size(12.8)
        .border(1)
        .border_color(c.active ? t.border : t.chrome)
        .bg(c.active ? t.raised : t.chrome)
        .text_color(c.active ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          this.pressed = i;
          if (e.click_count === 2) run("tab.rename", { id: c.id });
        })
        .on_mouse_up("left", () => {
          const from = this.pressed;
          this.pressed = null;
          if (from !== null && from !== i)
            run("tab.move", {
              id: shown[from].id,
              index: space.tabs.findIndex((x) => x.id === c.id) + 1,
            });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({
            mod: "menu",
            kind: "popup",
            width: 200,
            props: { tab: "tab", target: { id: c.id, space: space.id } },
          });
        })
        .when(Boolean(program?.icon), (el) =>
          el.child(
            program.tint
              ? svg(program.icon).size(14).text_color(t.muted)
              : image(program.icon).size(14),
          ),
        )
        .child(
          div()
            .max_w(170)
            .truncate()
            .child(c.zoomed ? `${name} Z` : name),
        )
        .when(c.status === "working", (el) =>
          el.child(
            svg("mods/workspace-chrome/spinner.svg")
              .size(12)
              .flex_none()
              .text_color(t.working)
              .spin(900),
          ),
        )
        .when(c.status === "blocked" || c.status === "done", (el) =>
          el.child(div().size(6).rounded(3).bg(t[c.status])),
        )
        .when(c.active, (el) =>
          el.child(
            div()
              .id(`close-${c.id}`)
              .text_color(t.dim)
              .on_mouse_down("left", stop)
              .on_click((_e, cx) => {
                cx.stop_propagation();
                run("tab.close", { id: c.id });
              })
              .child(svg("mods/pane/close.svg").size(12)),
          ),
        );
    };
    const root = layout(),
      sidebar = find(root, "sidebar"),
      w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding =
      w?.platform === "macos" &&
      w.titlebar === "none" &&
      !w.fullscreen &&
      root?.traffic_lights
        ? Math.max(
            10,
            (root.traffic_lights[0] + 64) / settings().zoom -
              (sidebar?.hidden ? 0 : (sidebar?.size?.px ?? 0)),
          )
        : 10;
    const panel = find(root, "panel"),
      body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex()
        .id(`panel-${id}`)
        .h(26)
        .px(8)
        .gap(5)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else {
            run("layout.select", { stack: "panel-body", child: id });
            run("layout.show", { id: "panel" });
          }
        })
        .child(svg(icon).size(14))
        .child(label);
    };
    const nav = (id, glyph, direction, hint) => {
      const can = this.target(direction) >= 0;
      return div()
        .id(id)
        .size(26)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .text_size(16)
        .text_color(can ? t.muted : t.border)
        .when(can, (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)),
        )
        .tooltip(hint)
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.step(direction);
          cx.notify();
        })
        .child(glyph);
    };
    const title = space?.name || "";
    return h_flex()
      .size_full()
      .min_w(0)
      .px(10)
      .pl(lightsPadding)
      .gap(3)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .on_mouse_up("left", () => {
        this.pressed = null;
      })
      .on_scroll_wheel((e) => {
        if (Math.abs(e.delta.y) >= 1)
          run(e.delta.y > 0 ? "tab.prev" : "tab.next");
      })
      .child(nav("nav-back", "\u2039", -1, "Back (\u2303\u2318\u2190)"))
      .child(nav("nav-forward", "\u203a", 1, "Forward (\u2303\u2318\u2192)"))
      .when(Boolean(title), (el) =>
        el.child(
          h_flex()
            .id("space-title")
            .flex_none()
            .max_w(320)
            .min_w(0)
            .h_full()
            .pl(6)
            .pr(10)
            .gap(6)
            .items_center()
            .child(
              div()
                .min_w(0)
                .truncate()
                .text_size(14)
                .font_semibold()
                .text_color(t.foreground)
                .child(title),
            )
            .when(Boolean(space?.machine), (el) =>
              el.child(
                div()
                  .flex_none()
                  .text_size(11)
                  .text_color(t.dim)
                  .child(space.machine),
              ),
            ),
        ),
      )
      .child(
        h_flex()
          .id("tab-scroll")
          .flex_1()
          .min_w(0)
          .h_full()
          .items_center()
          .gap(3)
          .overflow_x_scrollbar()
          .children(shown.map(item)),
      )
      .child(
        button("tab-new", "+", () =>
          openOverlay({
            mod: "new-menu",
            kind: "popup",
            width: 250,
            height: 512,
          }),
        ),
      )
      .when(enabled.includes("files"), (el) =>
        el.child(panelButton("files", "Files", "mods/files/file.svg")),
      )
      .when(enabled.includes("changes"), (el) =>
        el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")),
      )
      .when(w?.buttons, (el) =>
        el
          .child(
            button(
              "minimize",
              w.platform === "windows"
                ? svg("mods/my-tabs/win-min.svg").size(16)
                : "−",
              () => run("window.minimize"),
            ),
          )
          .child(
            button(
              "maximize",
              w.platform === "windows"
                ? svg(
                    `mods/my-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`,
                  ).size(16)
                : "□",
              () => run("window.maximize"),
            ),
          )
          .child(
            button(
              "close-window",
              w.platform === "windows"
                ? svg("mods/my-tabs/win-close.svg").size(16)
                : svg("mods/pane/close.svg").size(13),
              () => run("window.close"),
            ),
          ),
      );
  }
}
