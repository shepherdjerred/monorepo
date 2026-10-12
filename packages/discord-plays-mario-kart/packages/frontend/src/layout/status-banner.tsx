import IconDiscord from "~icons/ph/discord-logo-fill";
import IconHeadset from "~icons/ph/headset-fill";
import IconSteering from "~icons/ph/steering-wheel-fill";
import IconFlag from "~icons/ph/flag-banner-fill";
import IconPlugs from "~icons/ph/plugs-connected-fill";
import IconPlay from "~icons/ph/play-fill";
import type { ReactNode } from "react";
import type { PlayStatus, PlayStatusTone } from "#src/session/play-status.ts";
import { Button } from "#src/ui/button.tsx";
import { cx } from "#src/ui/cx.ts";

const TONES: Record<
  PlayStatusTone,
  { box: string; icon: string; glyph: ReactNode }
> = {
  driving: {
    box: "border-emerald-500/20 bg-emerald-500/[0.07]",
    icon: "bg-emerald-500/15 text-emerald-300",
    glyph: <IconSteering />,
  },
  ready: {
    box: "border-sky-400/20 bg-sky-400/[0.06]",
    icon: "bg-sky-400/15 text-sky-300",
    glyph: <IconPlay />,
  },
  blocked: {
    box: "border-discord/25 bg-discord/[0.08]",
    icon: "bg-discord/20 text-indigo-200",
    glyph: <IconHeadset />,
  },
  idle: {
    box: "border-border-subtle bg-surface-card",
    icon: "bg-white/5 text-ink-muted",
    glyph: <IconFlag />,
  },
  offline: {
    box: "border-amber-400/20 bg-amber-400/[0.06]",
    icon: "bg-amber-400/15 text-amber-200",
    glyph: <IconPlugs />,
  },
};

export function StatusBanner({
  status,
  signedOut,
  onSignIn,
}: {
  status: PlayStatus;
  signedOut: boolean;
  onSignIn: () => void;
}) {
  const tone = TONES[status.tone];
  return (
    <div
      role="status"
      className={cx(
        "flex animate-fade-in items-center gap-3 rounded-2xl border px-4 py-3",
        tone.box,
      )}
    >
      <span
        className={cx(
          "flex size-9 shrink-0 items-center justify-center rounded-xl text-lg",
          tone.icon,
        )}
      >
        {tone.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{status.title}</p>
        {status.detail === "" ? null : (
          <p className="text-xs text-ink-muted">{status.detail}</p>
        )}
      </div>
      {signedOut ? (
        <Button
          variant="discord"
          size="sm"
          icon={<IconDiscord className="size-4" />}
          onClick={onSignIn}
        >
          Sign in
        </Button>
      ) : null}
    </div>
  );
}
