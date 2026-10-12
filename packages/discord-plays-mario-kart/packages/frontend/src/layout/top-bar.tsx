import IconDiscord from "~icons/ph/discord-logo-fill";
import IconSignOut from "~icons/ph/sign-out-bold";
import IconWifi from "~icons/ph/wifi-high-bold";
import IconWifiOff from "~icons/ph/wifi-slash-bold";
import type { DiscordUser } from "@discord-plays-mario-kart/common";
import { Avatar } from "#src/ui/avatar.tsx";
import { Button } from "#src/ui/button.tsx";
import { cx } from "#src/ui/cx.ts";

function rttTone(rttMs: number): string {
  if (rttMs < 60) {
    return "text-emerald-300";
  }
  return rttMs < 140 ? "text-amber-200" : "text-red-300";
}

export function TopBar({
  connected,
  rttMs,
  me,
  meLoading,
  onSignIn,
  onSignOut,
}: {
  connected: boolean;
  rttMs: number | undefined;
  me: DiscordUser | undefined;
  meLoading: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-surface-page/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-strong to-[#b3201c] text-[11px] font-black tracking-tight text-white shadow-[0_6px_18px_-6px_var(--color-brand)]">
            64
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-bold text-ink">
              Mario Kart 64
            </div>
            <div className="hidden truncate text-[11px] text-ink-faint sm:block">
              Discord Plays
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-card px-2.5 text-xs font-medium",
              connected ? "text-ink-muted" : "text-amber-200",
            )}
            title={
              connected
                ? "Controller round trip to the game server"
                : "Reconnecting"
            }
          >
            {connected ? <IconWifi /> : <IconWifiOff />}
            {connected ? (
              rttMs === undefined ? (
                "Connected"
              ) : (
                <span className={cx("font-mono tabular-nums", rttTone(rttMs))}>
                  {rttMs}ms
                </span>
              )
            ) : (
              <span className="hidden sm:inline">Reconnecting…</span>
            )}
          </span>
          {me === undefined ? (
            <Button
              variant="discord"
              size="sm"
              icon={<IconDiscord className="size-4" />}
              disabled={meLoading}
              onClick={onSignIn}
            >
              <span className="hidden sm:inline">Sign in with Discord</span>
              <span className="sm:hidden">Sign in</span>
            </Button>
          ) : (
            <div className="flex h-9 items-center gap-2 rounded-full border border-border-subtle bg-surface-card py-1 pr-1 pl-1">
              <Avatar
                name={me.name}
                url={me.avatarUrl}
                seed={me.discordId}
                size="sm"
              />
              <span className="hidden max-w-36 truncate text-sm font-semibold text-ink sm:inline">
                {me.name}
              </span>
              <button
                type="button"
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex size-7 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
                onClick={onSignOut}
              >
                <IconSignOut />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
