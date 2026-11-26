const ICONS = {
  plus: "M12 5v14M5 12h14",
  tray: "M4 10h16v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM3 10l2.2-5h13.6L21 10",
  star: "M12 3.6l2.1 4.4 4.8.7-3.5 3.4.8 4.8L12 14.7 7.8 17l.8-4.8L5.1 8.7l4.8-.7z",
  calendar:
    "M7 3.5v3M17 3.5v3M4.5 9h15M6.5 5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  check:
    "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM8.2 12.2l2.4 2.4 5.2-5.4",
  tag: "M4.5 12.2 12 4.7h6.2v6.2l-7.5 7.5a1.6 1.6 0 0 1-2.3 0l-3.9-3.9a1.6 1.6 0 0 1 0-2.3zM16.2 8h.01",
  grid: "M5 5h5.5v5.5H5zM13.5 5H19v5.5h-5.5zM5 13.5h5.5V19H5zM13.5 13.5H19V19h-5.5z",
  search: "M11 18a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM16.2 16.2 20.5 20.5",
  sync: "M19.5 12a7.5 7.5 0 0 1-12.8 5.3M4.5 12A7.5 7.5 0 0 1 17.3 6.7M4.5 4.8v4.2h4.2M19.5 19.2v-4.2h-4.2",
} as const;

export type IconName = keyof typeof ICONS | "plus-circle";

export function Icon(props: { name: IconName }) {
  if (props.name === "plus-circle") {
    return (
      <svg
        className="icon icon-plus-circle"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    );
  }
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[props.name]} />
    </svg>
  );
}
