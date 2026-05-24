import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "#src/lib/use-theme.tsx";
import { cn } from "#src/lib/cn.ts";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center rounded-md border border-border bg-background p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = preference === option.value;
        const IconComponent = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            onClick={() => {
              setPreference(option.value);
            }}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected && "bg-accent text-foreground",
            )}
          >
            <IconComponent className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
