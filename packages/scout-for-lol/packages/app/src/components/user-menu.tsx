import { Bug, ChevronDown, ExternalLink, LogOut } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@scout-for-lol/design-system/components/dropdown-menu";
import { SUPPORT_URL } from "#src/lib/support.ts";
import { resetIdentity, trackAndFlush } from "#src/lib/analytics.ts";

async function logout() {
  // Flush the sign-out event before we navigate away — the `location.assign`
  // below would otherwise destroy a still-queued or in-flight analytics request
  // (same race the login / bot-install links handle via trackOutboundClick).
  await trackAndFlush("sign_out");
  // Only after that flush: resetting first would strip the identity off the
  // sign_out event itself. This unbinds the Discord user so the next person to
  // use a shared browser starts a fresh anonymous person.
  resetIdentity();
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
 * Account dropdown anchored to the navbar's `@username`. Theme selection lives
 * in the global navbar so it is available consistently on every surface.
 */
export function UserMenu(props: { username: string }) {
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
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">@{props.username}</span>
          <span className="block text-xs text-scout-subtle">
            Signed in with Discord
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
            <Bug className="h-4 w-4" aria-hidden="true" />
            Report a bug
            <ExternalLink
              className="ml-auto h-3 w-3 opacity-60"
              aria-hidden="true"
            />
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
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
