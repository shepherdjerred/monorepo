import { cx } from "./cx.ts";

const SIZES = {
  xs: "size-5 text-[10px]",
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-14 text-xl",
} as const;

// Discord's default-avatar palette, picked by id so a person keeps a colour.
const FALLBACK_COLOURS = [
  "bg-[#5865f2]",
  "bg-[#757e8a]",
  "bg-[#3ba55c]",
  "bg-[#faa61a]",
  "bg-[#ed4245]",
  "bg-[#eb459f]",
];

function fallbackColour(seed: string): string {
  let hash = 0;
  for (const ch of seed) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 9973;
  }
  return FALLBACK_COLOURS[hash % FALLBACK_COLOURS.length] ?? "bg-discord";
}

export function Avatar({
  name,
  url,
  seed,
  size = "md",
  className,
}: {
  name: string;
  url: string | null;
  /** Stable key for the fallback colour (the Discord id). */
  seed?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const base = cx(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/10",
    SIZES[size],
    className,
  );
  if (url !== null) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cx(base, "bg-surface-raised object-cover")}
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={cx(
        base,
        "font-semibold text-white",
        fallbackColour(seed ?? name),
      )}
    >
      {initial}
    </span>
  );
}
