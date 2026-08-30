import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "@/lib/activity-api";
import {
  type GameControlProps,
  revision,
  runSnapshotAction,
} from "@/components/activity-shared";

export function LobbyOperationControls(props: GameControlProps) {
  const trpc = useTRPC();
  const retryCode = useMutation(
    trpc.customs.retryTournamentCode.mutationOptions(),
  );
  const voiceOverride = useMutation(
    trpc.customs.overrideVoice.mutationOptions(),
  );
  const arrangeVoice = useMutation(trpc.customs.arrangeVoice.mutationOptions());
  const returnVoice = useMutation(trpc.customs.returnVoice.mutationOptions());

  if (props.game.state === "CODE_PENDING") {
    return (
      <button
        className="button primary"
        onClick={() => {
          void runSnapshotAction(
            retryCode.mutateAsync(revision(props.snapshot)),
            props,
          );
        }}
        type="button"
      >
        Recover tournament code
      </button>
    );
  }
  if (props.game.state !== "LOBBY_READY") return null;

  return (
    <div className="button-row">
      {props.game.voiceReady ||
      props.snapshot.teamAVoiceChannelId !== null ||
      props.snapshot.teamBVoiceChannelId !== null ? (
        <button
          className="button subtle"
          onClick={() => {
            void runSnapshotAction(
              returnVoice.mutateAsync(revision(props.snapshot)),
              props,
            );
          }}
          type="button"
        >
          Return everyone to lobby
        </button>
      ) : (
        <button
          className="button primary"
          disabled={props.game.voiceState === "PROVISIONING"}
          onClick={() => {
            void runSnapshotAction(
              arrangeVoice.mutateAsync(revision(props.snapshot)),
              props,
            );
          }}
          type="button"
        >
          {props.game.voiceState === "FAILED"
            ? "Retry team voice"
            : "Arrange team voice"}
        </button>
      )}
      <button
        className="button subtle"
        onClick={() => {
          void runSnapshotAction(
            voiceOverride.mutateAsync({
              ...revision(props.snapshot),
              enabled: !props.game.voiceOverride,
            }),
            props,
          );
        }}
        type="button"
      >
        {props.game.voiceOverride ? "Require voice recovery" : "Override voice"}
      </button>
      <p className="waiting">
        Start the lobby in League. Scout advances only when Riot observes the
        game.
      </p>
    </div>
  );
}

export function SubstitutionControls(props: GameControlProps) {
  const trpc = useTRPC();
  const substitute = useMutation(trpc.customs.substitute.mutationOptions());
  const [outgoing, setOutgoing] = useState("");
  const [incoming, setIncoming] = useState("");
  const eligible = ["ROSTER_OPEN", "CAPTAINS_SET", "DRAFTING"].includes(
    props.game.state,
  );
  if (!eligible) return null;

  return (
    <div className="button-row">
      <select
        aria-label="Outgoing player"
        className="text-input"
        onChange={(event) => {
          setOutgoing(event.target.value);
        }}
        value={outgoing}
      >
        <option value="">Outgoing player</option>
        {props.game.participants.map((participant) => (
          <option key={participant.discordId} value={participant.discordId}>
            {participant.displayName}
          </option>
        ))}
      </select>
      <select
        aria-label="Incoming player"
        className="text-input"
        onChange={(event) => {
          setIncoming(event.target.value);
        }}
        value={incoming}
      >
        <option value="">Incoming player</option>
        {props.snapshot.participants
          .filter(
            (participant) =>
              !props.game.participants.some(
                (current) => current.discordId === participant.discordId,
              ),
          )
          .map((participant) => (
            <option key={participant.discordId} value={participant.discordId}>
              {participant.displayName}
            </option>
          ))}
      </select>
      <button
        className="button subtle"
        disabled={outgoing === "" || incoming === ""}
        onClick={() => {
          void runSnapshotAction(
            substitute.mutateAsync({
              ...revision(props.snapshot),
              outgoingDiscordId: DiscordAccountIdSchema.parse(outgoing),
              incomingDiscordId: DiscordAccountIdSchema.parse(incoming),
            }),
            props,
          );
        }}
        type="button"
      >
        Substitute player
      </button>
    </div>
  );
}

export function VoidGameControl(props: GameControlProps) {
  const trpc = useTRPC();
  const voidGame = useMutation(trpc.customs.voidGame.mutationOptions());
  if (props.game.state === "VERIFIED" || props.game.state === "VOID") {
    return null;
  }

  return (
    <button
      className="button danger"
      onClick={() => {
        void runSnapshotAction(
          voidGame.mutateAsync({
            ...revision(props.snapshot),
            reason: "Host explicitly voided this game from the Activity",
          }),
          props,
        );
      }}
      type="button"
    >
      Void game
    </button>
  );
}
