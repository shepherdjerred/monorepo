import {
  Bookmark,
  Bug,
  CalendarClock,
  Flag,
  Flame,
  Inbox,
  Layers,
  ListTodo,
  Rocket,
  Star,
  Target,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** The icons a view can wear; a view stores the name. */
export const viewIcons: readonly {
  name: string;
  label: string;
  Icon: LucideIcon;
}[] = [
  { name: "list", label: "List", Icon: ListTodo },
  { name: "star", label: "Star", Icon: Star },
  { name: "flame", label: "Flame", Icon: Flame },
  { name: "bug", label: "Bug", Icon: Bug },
  { name: "rocket", label: "Rocket", Icon: Rocket },
  { name: "target", label: "Target", Icon: Target },
  { name: "inbox", label: "Inbox", Icon: Inbox },
  { name: "calendar", label: "Calendar", Icon: CalendarClock },
  { name: "user", label: "Person", Icon: UserRound },
  { name: "zap", label: "Lightning", Icon: Zap },
  { name: "flag", label: "Flag", Icon: Flag },
  { name: "bookmark", label: "Bookmark", Icon: Bookmark },
  { name: "layers", label: "Layers", Icon: Layers },
];

/**
 * A view's icon. Views made elsewhere (the CLI takes any short string) show
 * the default list icon for a name this browser does not know.
 */
export function ViewIcon({ name, size = 15 }: { name: string; size?: number }) {
  const known = viewIcons.find((icon) => icon.name === name) ?? viewIcons[0];
  if (known === undefined) {
    throw new Error("There are no view icons");
  }
  return <known.Icon size={size} aria-hidden="true" />;
}
