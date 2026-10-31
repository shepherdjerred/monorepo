// Notifications as small pills: a dot or icon and the title on one line. The body
// is the tooltip. Click to run its action (e.g. go to the agent) and dismiss it.

import { View, div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, closeOverlay, run, theme } from "herdr";

const DOT = {
  error: "blocked",
  warning: "working",
  success: "done",
  info: "accent",
};

export default class Toast extends View {
  render(cx) {
    const t = theme();
    const p = props() ?? {};
    return h_flex()
      .id("toast")
      .size_full()
      .px(12)
      .gap(8)
      .items_center()
      .rounded_full()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .when(Boolean(p.body), (el) => el.tooltip(p.body))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(
        p.icon
          ? image(p.icon).w(14).h(14).flex_none()
          : div()
              .size(7)
              .rounded(4)
              .flex_none()
              .bg(t[DOT[p.level] ?? "accent"]),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .font_medium()
          .text_size(12)
          .text_color(t.foreground)
          .child(p.title ?? ""),
      );
  }
}
