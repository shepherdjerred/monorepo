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
  "arrow-right": "M5 12h14m-6-6 6 6-6 6",
  "chevron-left": "m15 6-6 6 6 6",
  "chevron-right": "m9 6 6 6-6 6",
  "chevron-down": "m6 9 6 6 6-6",
  clock: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Zm0-13V12l3 2",
  folder:
    "M4 8V6.5A1.5 1.5 0 0 1 5.5 5H10l2 2h6.5A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z",
  filter: "M4 6h16l-6 7v4l-4 2v-6z",
  subtasks: "M5 5h4v4H5zM15 15h4v4h-4zM7 9v8h8M13 7h6",
  repeat:
    "M17 2l4 4-4 4m4-4H7a4 4 0 0 0-4 4m4 12-4-4 4-4m-4 4h14a4 4 0 0 0 4-4",
} as const;

export type IconName = keyof typeof ICONS | "plus-circle";

export function FacetMark() {
  return (
    <svg className="facet-mark" viewBox="0 0 36 36" aria-hidden="true">
      <path
        className="facet-mark-base"
        d="M18 3.5 30.5 11v14L18 32.5 5.5 25V11z"
      />
      <path className="facet-mark-top" d="M18 3.5 30.5 11 18 18.5 5.5 11z" />
      <path className="facet-mark-side" d="M18 18.5 30.5 11v14L18 32.5z" />
      <path className="facet-mark-check" d="m12.5 16.5 4.2 6.1 7.2-8.1" />
    </svg>
  );
}

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
