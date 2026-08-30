import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/lib/activity-api";
import {
  type ActivityControlProps,
  type GameControlProps,
  revision,
  runSnapshotAction,
  StatePill,
} from "@/components/activity-shared";
import { DraftControls } from "@/components/game-draft-controls";
import {
  LobbyOperationControls,
  SubstitutionControls,
  VoidGameControl,
} from "@/components/game-operation-controls";
import {
  IntermissionControls,
  PrepareRosterControls,
} from "@/components/game-preparation";

function ActiveGameControls(props: GameControlProps & { manager: boolean }) {
  const waitingForRiot =
    props.game.state === "PLAYING" || props.game.state === "RESULT_PENDING";

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Game {props.game.sequence.toString()}</h2>
        <StatePill state={props.game.state} />
      </div>
      {props.game.tournamentLobby?.code === null ||
      props.game.tournamentLobby === null ? null : (
        <div className="code-card">
          <span>Tournament code</span>
          <code>{props.game.tournamentLobby.code}</code>
        </div>
      )}
      <div className="teams">
        {(["A", "B"] as const).map((team) => (
          <div key={team}>
            <h3>Team {team}</h3>
            {props.game.participants
              .filter((participant) => participant.team === team)
              .map((participant) => (
                <p key={participant.discordId}>
                  {participant.captain ? "♛ " : ""}
                  {participant.displayName}
                </p>
              ))}
          </div>
        ))}
      </div>
      <DraftControls {...props} />
      {props.manager ? <LobbyOperationControls {...props} /> : null}
      {waitingForRiot ? (
        <p className="waiting">
          Waiting for Riot Match-V5. Results cannot be entered manually.
        </p>
      ) : null}
      {props.manager ? <SubstitutionControls {...props} /> : null}
      {props.manager ? <VoidGameControl {...props} /> : null}
    </section>
  );
}

function RecruitmentControls(props: ActivityControlProps) {
  const trpc = useTRPC();
  const prepareNight = useMutation(trpc.customs.prepareNight.mutationOptions());
  return (
    <section className="panel action-panel">
      <h2>Ready to build game one?</h2>
      <button
        className="button primary"
        disabled={props.snapshot.participants.length < 10}
        onClick={() => {
          void runSnapshotAction(
            prepareNight.mutateAsync(revision(props.snapshot)),
            props,
          );
        }}
        type="button"
      >
        Close recruitment
      </button>
      {props.snapshot.participants.length < 10 ? (
        <p>
          {(10 - props.snapshot.participants.length).toString()} more players
          required.
        </p>
      ) : null}
    </section>
  );
}

export function GameControls(props: ActivityControlProps) {
  const manager = ["HOST", "COHOST", "ADMIN"].includes(
    props.snapshot.viewerRole,
  );
  if (props.snapshot.state === "RECRUITING") {
    return manager ? (
      <RecruitmentControls {...props} />
    ) : (
      <section className="panel">
        <h2>Recruitment</h2>
        <p>The host is preparing this custom night.</p>
      </section>
    );
  }
  if (props.snapshot.currentGame === null) {
    return manager ? (
      <PrepareRosterControls {...props} />
    ) : (
      <section className="panel">
        <h2>Game</h2>
        <p>The host is preparing the next roster.</p>
      </section>
    );
  }
  const captain = props.snapshot.currentGame.participants.some(
    (participant) =>
      participant.captain && participant.discordId === props.viewerId,
  );
  if (!manager && !captain) {
    return (
      <section className="panel">
        <h2>Game</h2>
        <p>Hosts and captains control the draft. This view updates live.</p>
      </section>
    );
  }
  const gameProps = { ...props, game: props.snapshot.currentGame };
  if (
    props.snapshot.state === "INTERMISSION" &&
    (gameProps.game.state === "VERIFIED" || gameProps.game.state === "VOID")
  ) {
    return manager ? <IntermissionControls {...gameProps} /> : null;
  }
  return <ActiveGameControls {...gameProps} manager={manager} />;
}
