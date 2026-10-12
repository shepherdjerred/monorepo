import { GameView } from "./game-view.tsx";
import { socket } from "./socket.ts";
import { DesktopController } from "./controls/desktop-controller.tsx";
import { TouchController } from "./controls/touch-controller.tsx";
import { useController } from "./input/use-controller.ts";
import { RotateHint, Stage } from "./layout/stage.tsx";
import { SeatStrip } from "./layout/seat-strip.tsx";
import { StatusBanner } from "./layout/status-banner.tsx";
import { Toast } from "./layout/toast.tsx";
import { TopBar } from "./layout/top-bar.tsx";
import {
  signIn,
  useMe,
  useSignOut,
} from "@shepherdjerred/discord-plays-web/session/me.ts";
import {
  describePlayStatus,
  describeSeatDenied,
} from "./session/play-status.ts";
import { useGame } from "./session/use-game.ts";
import { StatsCard } from "./stats/stats-card.tsx";
import { useMediaQuery } from "./ui/use-media-query.ts";

/** Phones held sideways: short enough that the page layout cannot fit a pad. */
const TOUCH_LANDSCAPE = "(orientation: landscape) and (max-height: 540px)";
const PHONE_PORTRAIT = "(max-width: 767px)";

function stageMessage(
  seated: boolean,
  feedEnabled: boolean,
  noSession: boolean,
): string {
  if (noSession) {
    return "Waiting for someone to start a game";
  }
  return seated && !feedEnabled
    ? "Watch the stream in Discord while you drive"
    : "Take a seat to get the live feed";
}

export function App() {
  const game = useGame();
  const { me, loading: meLoading } = useMe();
  const signOut = useSignOut(socket);
  const controller = useController(game.seat);
  const touchLandscape = useMediaQuery(TOUCH_LANDSCAPE);
  const phonePortrait = useMediaQuery(PHONE_PORTRAIT);

  const user = me.signedIn ? me.user : undefined;
  const voiceChannelName = game.status?.voiceChannel?.name;
  const blocker = game.status?.playBlocker;
  const seated = game.seat !== null;
  const feedEnabled = game.status?.driverFeedEnabled === true;
  const driverSocketId = socket.id;
  const showFeed = seated && feedEnabled && driverSocketId !== undefined;
  const touchMode = seated && touchLandscape;

  const playStatus = describePlayStatus({
    connected: game.connected,
    blocker,
    voiceChannelName,
    seat: game.seat,
  });

  const claim = (seat: number) => {
    // Signing in is the only fix for a signed-out claim, so go straight there.
    if (blocker === "signed-out") {
      signIn();
      return;
    }
    game.claim(seat);
  };

  return (
    <div className="min-h-dvh text-ink">
      <TopBar
        connected={game.connected}
        rttMs={game.rttMs}
        me={user}
        meLoading={meLoading}
        onSignIn={signIn}
        onSignOut={() => {
          void signOut();
        }}
      />
      <main className="mx-auto grid max-w-[1440px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:py-6">
        <div className="min-w-0 space-y-4">
          <StatusBanner
            status={playStatus}
            signedOut={blocker === "signed-out"}
            onSignIn={signIn}
          />
          <SeatStrip
            seats={game.seats}
            mySeat={game.seat}
            onClaim={claim}
            onRelease={game.release}
          />
          {showFeed && !touchMode ? (
            <GameView driverSocketId={driverSocketId} />
          ) : null}
          {showFeed ? null : (
            <Stage
              message={stageMessage(
                seated,
                feedEnabled,
                blocker === "no-session",
              )}
            />
          )}
          {phonePortrait && seated ? <RotateHint /> : null}
          {phonePortrait || touchMode ? null : (
            <DesktopController controller={controller} seated={seated} />
          )}
        </div>
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <StatsCard me={user} onSignIn={signIn} />
        </aside>
      </main>
      {touchMode ? (
        <TouchController
          controller={controller}
          seat={game.seat}
          onLeave={game.release}
          feed={
            showFeed ? (
              <GameView driverSocketId={driverSocketId} variant="bare" />
            ) : (
              <p className="px-4 text-center text-xs text-ink-faint">
                Watch the stream in Discord while you drive.
              </p>
            )
          }
        />
      ) : null}
      {game.denial === undefined ? null : (
        <Toast
          message={describeSeatDenied(game.denial.reason, voiceChannelName)}
          stamp={game.denial.at}
          onDismiss={game.dismissDenial}
        />
      )}
    </div>
  );
}
