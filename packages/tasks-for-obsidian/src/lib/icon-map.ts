/**
 * Maps Feather icon names to SF Symbol names for iOS.
 * When an icon is used on iOS, we look up the SF Symbol equivalent here.
 * If no mapping exists, we fall back to the Feather icon.
 */
export const ICON_MAP: Record<string, string> = {
  inbox: "tray.fill",
  star: "star.fill",
  calendar: "calendar",
  grid: "square.grid.2x2",
  search: "magnifyingglass",
  settings: "gearshape",
  plus: "plus.circle.fill",
  check: "checkmark.circle.fill",
  "trash-2": "trash.fill",
  "edit-2": "pencil",
  edit: "pencil",
  "chevron-right": "chevron.right",
  x: "xmark",
  filter: "line.3.horizontal.decrease",
  sliders: "slider.horizontal.3",
  "arrow-up": "arrow.up",
  "arrow-down": "arrow.down",
  clock: "clock",
  tag: "tag",
  folder: "folder",
  "refresh-cw": "arrow.clockwise",
  "wifi-off": "wifi.slash",
  "alert-circle": "exclamationmark.circle",
  "check-circle": "checkmark.circle",
  circle: "circle",
  "minus-circle": "minus.circle",
  "more-horizontal": "ellipsis",
  play: "play.fill",
  pause: "pause.fill",
  square: "stop.fill",
  columns: "rectangle.split.3x1",
};
