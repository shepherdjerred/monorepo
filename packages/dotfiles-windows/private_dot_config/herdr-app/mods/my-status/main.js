import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  spaces,
  agents,
  theme,
  run,
  window,
  shared,
  setShared,
  props,
  openOverlay,
  closeOverlay,
} from "herdr";

// Brim quotas (my-agents polls them into "brim.quotas"): one program icon each, in
// Brim's order, with a dot for headroom. Red only on evidence, the same rule as hiding
// ("brim.exhausted"); a provider at its limit fades. The numbers show on hover.
// One color each: the app's own glyphs, or this mod's single-color copies of its
// full-color pictures (the app rewrites icons/).
const ICON = {
  "claude-code": "mods/my-status/icons/claude.svg",
  codex: "mods/my-status/icons/codex.svg",
  antigravity: "mods/my-status/icons/antigravity.svg",
  cursor: "icons/cursor.svg",
  grok: "icons/grok.svg",
  kimi: "mods/my-status/icons/kimi.svg",
  muse: "icons/muse.svg",
};
const pct = (n) => `${Math.round(n)}%`;
// What Brim knows about a provider, one line each: the hover card's lines.
function details(q, out) {
  return [
    q.accountLabel && `Account: ${q.accountLabel}`,
    q.fiveHourUsed != null && `5-hour: ${pct(q.fiveHourUsed)} used`,
    q.budgetUsed != null &&
      `${q.budgetKind === "monthly" ? "Monthly" : q.budgetKind === "weekly" ? "Weekly" : "Budget"}: ${pct(q.budgetUsed)} used`,
    q.budgetResetsIn && `Resets in ${q.budgetResetsIn}`,
    out && `At limit: ${out.reason}`,
    !out && q.reason && `Brim: ${q.reason}`,
    q.snapshotAge && `Snapshot ${q.snapshotAge}`,
  ].filter(Boolean);
}
const headroom = (q, out, t) => {
  const used = [q.fiveHourUsed, q.budgetUsed].filter((n) => n != null);
  return out
    ? t.blocked
    : !used.length
      ? t.dim
      : Math.max(...used) >= 80
        ? t.working
        : t.done;
};

function chip(q, t, out, onHover) {
  const pic = ICON[q.provider]
    ? svg(ICON[q.provider]).size(15).text_color(t.muted)
    : div()
        .size(15)
        .rounded(4)
        .bg(t.raised)
        .text_size(8.5)
        .font_semibold()
        .text_color(t.muted)
        .flex()
        .items_center()
        .justify_center()
        .child(q.displayName.slice(0, 2));
  return div()
    .id(`quota-${q.provider}`)
    .flex_none()
    .p(3)
    .rounded(5)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_hover((h) => onHover(q, h))
    .on_click(() =>
      setShared("hide.exhausted", shared("hide.exhausted") === false),
    )
    .child(
      div()
        .relative()
        .size(15)
        .child(
          div()
            .size_full()
            .when(Boolean(out), (el) => el.opacity(0.4))
            .child(pic),
        )
        .child(
          div()
            .absolute()
            .bottom(-2)
            .right(-3)
            .size(7)
            .rounded(4)
            .border(1.5)
            .border_color(t.chrome)
            .bg(headroom(q, out, t)),
        ),
    );
}

// The hover card: this mod again, as a window above the bar (the shell's
// tooltip shows no multi-line label here).
function card(provider, t) {
  const q = (shared("brim.quotas") ?? []).find((k) => k.provider === provider);
  if (!q) return div();
  const out = (shared("brim.exhausted") ?? {})[provider];
  return v_flex()
    .size_full()
    .p(10)
    .gap(3)
    .bg(t.popover)
    .text_size(12)
    .text_color(t.muted)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .pb(2)
        .child(
          div()
            .size(7)
            .rounded(4)
            .flex_none()
            .bg(headroom(q, out, t)),
        )
        .child(
          div().font_semibold().text_color(t.foreground).child(q.displayName),
        ),
    )
    .children(details(q, out).map((line) => div().child(line)))
    .child(
      div()
        .pt(3)
        .text_color(t.dim)
        .child(
          `Click to ${shared("hide.exhausted") === false ? "hide" : "show"} chats at limit`,
        ),
    );
}
const CARD_W = 230;

export default class WorkspaceStatus extends View {
  init() {
    if (props()?.card) return;
    this.pos = { x: 0, y: 0 };
    // A card left open by an earlier build closes itself (see render).
    setShared("my-status.card", null);
    // One card at a time; moving to the next icon replaces it before the old one's exit.
    this.onHover = (q, h) => {
      if (h) {
        if (this.card) closeOverlay(this.card);
        // Sized by its content; this estimate only keeps it clear of the pointer.
        const height =
          70 +
          22 * details(q, (shared("brim.exhausted") ?? {})[q.provider]).length;
        const at = {
          x: Math.max(8, Math.round(this.pos.x - CARD_W + 40)),
          y: Math.max(8, Math.round(this.pos.y - height - 24)),
        };
        this.card = openOverlay({
          mod: "my-status",
          kind: "window",
          props: { card: q.provider },
          width: CARD_W,
          at,
        });
        this.cardFor = q.provider;
        setShared("my-status.card", this.card);
      } else if (this.cardFor === q.provider) {
        closeOverlay(this.card);
        this.card = this.cardFor = null;
        setShared("my-status.card", null);
      }
    };
  }

  async close() {
    if (this.card) closeOverlay(this.card);
  }

  render() {
    const t = theme();
    if (props()?.card) {
      if (shared("my-status.card") !== props().overlay) {
        closeOverlay(props().overlay);
        return div();
      }
      return card(props().card, t);
    }
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const label = (icon, text) =>
      h_flex()
        .gap(6)
        .items_center()
        .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13))
        .child(text);
    const quotas = shared("brim.quotas") ?? [];
    const limits = shared("brim.exhausted") ?? {};
    // Where the pointer is, for placing the hover card.
    return h_flex()
      .id("status-root")
      .on_mouse_move((e) => {
        this.pos = e.position;
      })
      .size_full()
      .px(14)
      .gap(16)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      .child(
        label(
          space?.machine ? "server" : "monitor",
          space?.machine ?? "This computer",
        ),
      )
      .when(Boolean(space?.branch), (el) =>
        el.child(label("branch", space.branch)),
      )
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().size(6).rounded(3).bg(t.dim))
          .child(`${list.length} agents`)
          .when(needs > 0, (el) =>
            el.child(div().text_color(t.blocked).child(`· ${needs} needs you`)),
          ),
      )
      .child(div().flex_1())
      .when(quotas.length > 0, (el) =>
        el.child(
          h_flex()
            .gap(3)
            .items_center()
            .children(
              quotas.map((q) => chip(q, t, limits[q.provider], this.onHover)),
            ),
        ),
      )
      .child(
        div()
          .id("palette")
          .text_color(t.dim)
          .on_click(() => run("app.palette"))
          .child(
            `${window()?.platform === "macos" ? "⌘" : "Ctrl"} Shift P  commands`,
          ),
      );
  }
}
