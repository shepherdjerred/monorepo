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
      <DropdownMenuContent align="end" sideOffset={8} className="w-52">
        <DropdownMenuLabel className="font-normal !text-left !block px-2 py-1.5">
          <span className="block text-xs font-semibold text-scout-ink">
            @{props.username}
          </span>
          <span className="block text-[11px] text-scout-subtle">
            Signed in with Discord
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2 text-xs">
          <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
            <Bug className="size-3.5 text-scout-subtle" aria-hidden="true" />
            <span>Report a bug</span>
            <ExternalLink
              className="ml-auto size-3 opacity-60"
              aria-hidden="true"
            />
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-xs text-scout-danger focus:bg-scout-danger/10 focus:text-scout-danger"
          onSelect={() => {
            void logout();
          }}
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
