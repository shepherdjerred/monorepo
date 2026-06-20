import { Bug, ChevronDown, LogOut } from "lucide-react";
import { Button } from "#src/components/ui/button.tsx";
import { ThemeToggle } from "#src/components/ui/theme-toggle.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#src/components/ui/popover.tsx";
import { SUPPORT_URL } from "#src/lib/support.ts";

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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-sm font-medium"
        >
          @{props.username}
          <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-3 p-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Theme
          </p>
          <ThemeToggle />
        </div>
        <div className="h-px bg-border" />
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Bug className="h-4 w-4" aria-hidden="true" />
          Report a bug
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            void logout();
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </PopoverContent>
    </Popover>
  );
}
