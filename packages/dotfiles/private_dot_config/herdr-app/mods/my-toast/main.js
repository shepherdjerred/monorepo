import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  agents,
  closeOverlay,
  panes,
  props,
  run,
  shared,
  terminals,
  theme,
} from "herdr";

const DOT = {
  error: "blocked",
  warning: "working",
  success: "done",
  info: "accent",
};

function origin(action, heading) {
  const args = action?.args;
  const address =
    typeof args?.terminal === "string"
      ? args.terminal
      : args?.pane && panes().find((pane) => pane.pane === args.pane)?.terminal;
  if (!address) return null;
  const agent = agents().find((a) => a.address === address);
  const term = terminals().find((entry) => entry.address === address);
  if (!agent && !term) return null;
  const host = address.includes("/")
    ? address.split("/")[0]
    : shared("herdr.local-host") || "This host";
  const name =
    term?.labels?.["herdr.agent-name"] ||
    agent?.program?.name ||
    term?.program?.name ||
    term?.name ||
    address;
  return heading === name || heading.startsWith(`${name} `)
    ? host
    : `${name} · ${host}`;
}

export default class Toast extends View {
  activate(p) {
    if (p.action?.name) run(p.action.name, p.action.args ?? {});
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const login =
      /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(
        p.body ?? "",
      );
    const command = login ? `hc machine login ${login[1]}` : null;
    const heading = login ? `${login[1]} needs a login` : (p.title ?? "");
    const detail = [origin(p.action, heading), p.body]
      .filter(Boolean)
      .join(" · ");
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.activate(p))
      .child(
        p.icon
          ? image(p.icon).w(18).h(18).flex_none()
          : div()
              .size(8)
              .rounded(4)
              .flex_none()
              .bg(t[DOT[p.level] ?? "accent"]),
      )
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(
            div()
              .truncate()
              .font_semibold()
              .text_size(13)
              .text_color(t.foreground)
              .child(heading),
          )
          .when(!login && Boolean(detail), (el) =>
            el.child(
              div()
                .truncate()
                .tooltip(detail)
                .text_size(12)
                .text_color(t.muted)
                .child(detail),
            ),
          )
          .when(Boolean(login), (el) =>
            el.child(
              h_flex()
                .gap(8)
                .items_center()
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .tooltip(command)
                    .text_size(12)
                    .text_color(t.muted)
                    .child(command),
                )
                .child(
                  div()
                    .id("toast-login-copy")
                    .flex_none()
                    .px(6)
                    .py(3)
                    .rounded(4)
                    .bg(t.raised)
                    .text_size(12)
                    .text_color(t.foreground)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      cx.write_to_clipboard(command);
                      this.copied = true;
                      cx.notify();
                    })
                    .child(this.copied ? "Copied" : "Copy"),
                ),
            ),
          ),
      );
  }
}
