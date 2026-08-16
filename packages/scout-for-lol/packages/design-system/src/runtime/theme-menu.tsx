import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { Button } from "#src/components/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#src/components/popover.tsx";
import { type ScoutModePreference, type ScoutSkin } from "./theme.ts";
import { useScoutTheme } from "./context.tsx";

const skins: { value: ScoutSkin; label: string }[] = [
  { value: "modern", label: "Modern" },
  { value: "classic", label: "Classic" },
];
const modes: { value: ScoutModePreference; label: string; icon: typeof Sun }[] =
  [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];

export function ThemeMenu() {
  const theme = useScoutTheme();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Choose Scout theme">
          <Palette size={18} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="scout-theme-menu">
          <div className="scout-field">
            <span className="scout-label">Skin</span>
            <div className="scout-segmented">
              {skins.map((skin) => (
                <button
                  key={skin.value}
                  type="button"
                  aria-pressed={theme.preference.skin === skin.value}
                  onClick={() => {
                    theme.setSkin(skin.value);
                  }}
                >
                  {skin.label}
                </button>
              ))}
            </div>
          </div>
          <div className="scout-field">
            <span className="scout-label">Appearance</span>
            <div className="scout-segmented">
              {modes.map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    aria-label={mode.label}
                    aria-pressed={theme.preference.mode === mode.value}
                    onClick={() => {
                      theme.setMode(mode.value);
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span className="scout-sr-only">{mode.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
