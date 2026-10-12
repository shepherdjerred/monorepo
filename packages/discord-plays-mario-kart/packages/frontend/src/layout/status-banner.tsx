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
    box: "border-mk-green/40 bg-[linear-gradient(90deg,rgb(31_176_84/0.22),rgb(31_176_84/0.06))]",
    icon: "bg-mk-green text-white shadow-[0_3px_0_#0d6b30]",
    glyph: <IconSteering />,
  },
  ready: {
    box: "border-mk-sky/40 bg-[linear-gradient(90deg,rgb(89_184_255/0.2),rgb(89_184_255/0.05))]",
    icon: "bg-mk-blue text-white shadow-[0_3px_0_#123f86]",
    glyph: <IconPlay />,
  },
  blocked: {
    box: "border-discord/40 bg-[linear-gradient(90deg,rgb(88_101_242/0.24),rgb(88_101_242/0.06))]",
    icon: "bg-discord text-white shadow-[0_3px_0_#3a44b0]",
    glyph: <IconHeadset />,
  },
  idle: {
    box: "border-border-strong bg-[linear-gradient(90deg,#18215a,#10173a)]",
    icon: "bg-mk-red text-mk-yellow shadow-[0_3px_0_#7a0915]",
    glyph: <IconFlag />,
  },
  offline: {
    box: "border-mk-yellow/40 bg-[linear-gradient(90deg,rgb(255_210_31/0.18),rgb(255_210_31/0.04))]",
    icon: "bg-mk-yellow text-[#3a2a00] shadow-[0_3px_0_#8a6a00]",
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
        "mk-speed-lines relative flex animate-speed-lines items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3",
        tone.box,
      )}
    >
      <span
        className={cx(
          "relative flex size-10 shrink-0 -skew-x-6 items-center justify-center rounded-xl text-xl",
          tone.icon,
        )}
      >
        {tone.glyph}
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="mk-title text-xl leading-tight text-white">
          {status.title}
        </p>
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
