import { Bug, ChevronDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "#src/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "#src/components/ui/dropdown-menu.tsx";
import { SUPPORT_URL } from "#src/lib/support.ts";
import { useTheme, type ThemePreference } from "#src/lib/use-theme.tsx";

type ThemeOption = {
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
};

const SYSTEM_THEME_OPTION: ThemeOption = {
  value: "system",
  label: "System",
  icon: Monitor,
};

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "Light", icon: Sun },
  SYSTEM_THEME_OPTION,
  { value: "dark", label: "Dark", icon: Moon },
];

function getThemeOption(value: ThemePreference): ThemeOption {
  return (
    THEME_OPTIONS.find((option) => option.value === value) ??
    SYSTEM_THEME_OPTION
  );
}

function parseThemePreference(value: string): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  throw new Error(`Unexpected theme preference: ${value}`);
}

async function logout() {
  // Always navigate to /app/login, even if the fetch fails — the user
  // expects "Sign out" to land them on the login page regardless.
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } finally {
    globalThis.location.assign("/app/login");
  }
}

/**
 * Account dropdown anchored to the navbar's `@username`. Holds the theme
 * selector, the bug/feature-request link, and sign-out.
 */
export function UserMenu(props: { username: string }) {
  const { preference, setPreference } = useTheme();
  const currentTheme = getThemeOption(preference);
  const CurrentThemeIcon = currentTheme.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-sm font-medium"
        >
          @{props.username}
          <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <CurrentThemeIcon className="h-4 w-4" aria-hidden="true" />
            <span>Theme</span>
            <span className="ml-auto mr-1 text-xs text-muted-foreground">
              {currentTheme.label}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-36">
            <DropdownMenuRadioGroup
              value={preference}
              onValueChange={(value) => {
                setPreference(parseThemePreference(value));
              }}
            >
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;

                return (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="gap-2"
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{option.label}</span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
            <Bug className="h-4 w-4" aria-hidden="true" />
            Report a bug
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => {
            void logout();
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
