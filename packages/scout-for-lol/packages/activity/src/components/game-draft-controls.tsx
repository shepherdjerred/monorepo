import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "@/lib/activity-api";
import {
  type GameControlProps,
  revision,
  runSnapshotAction,
} from "@/components/activity-shared";

function CaptainControls(props: GameControlProps) {
  const trpc = useTRPC();
  const captains = useMutation(trpc.customs.selectCaptains.mutationOptions());
  const [captainA, setCaptainA] = useState("");
  const [captainB, setCaptainB] = useState("");
  const setSelectedCaptains = (): void => {
    void runSnapshotAction(
      captains.mutateAsync({
        ...revision(props.snapshot),
        captainADiscordId: DiscordAccountIdSchema.parse(captainA),
        captainBDiscordId: DiscordAccountIdSchema.parse(captainB),
      }),
      props,
    );
  };

  return (
    <>
      <button
        className="button primary"
        onClick={() => {
          void runSnapshotAction(
            captains.mutateAsync(revision(props.snapshot)),
            props,
          );
        }}
        type="button"
      >
        Choose random captains
      </button>
      <select
        aria-label="Captain A"
        className="text-input"
        onChange={(event) => {
          setCaptainA(event.target.value);
        }}
        value={captainA}
      >
        <option value="">Captain A</option>
        {props.game.participants.map((participant) => (
          <option key={participant.discordId} value={participant.discordId}>
            {participant.displayName}
          </option>
        ))}
      </select>
      <select
        aria-label="Captain B"
        className="text-input"
        onChange={(event) => {
          setCaptainB(event.target.value);
        }}
        value={captainB}
      >
        <option value="">Captain B</option>
        {props.game.participants.map((participant) => (
          <option key={participant.discordId} value={participant.discordId}>
            {participant.displayName}
          </option>
        ))}
      </select>
      <button
        className="button subtle"
        disabled={captainA === "" || captainB === ""}
        onClick={setSelectedCaptains}
        type="button"
      >
        Set captains
      </button>
    </>
  );
}

function UnassignedPlayerControls(
  props: GameControlProps & { manager: boolean },
) {
  const trpc = useTRPC();
  const assign = useMutation(trpc.customs.assignTeam.mutationOptions());
  const pick = useMutation(trpc.customs.pick.mutationOptions());
  const unassigned = props.game.participants.filter(
    (participant) => !participant.captain && participant.team === null,
  );

  return unassigned.map((participant) => (
    <span className="draft-row" key={participant.discordId}>
      <button
        className="button subtle"
        onClick={() => {
          void runSnapshotAction(
            pick.mutateAsync({
              ...revision(props.snapshot),
              discordId: DiscordAccountIdSchema.parse(participant.discordId),
            }),
            props,
          );
        }}
        type="button"
      >
        Draft {participant.displayName}
      </button>
      {props.manager
        ? (["A", "B"] as const).map((team) => (
            <button
              className="button subtle"
              key={team}
              onClick={() => {
                void runSnapshotAction(
                  assign.mutateAsync({
                    ...revision(props.snapshot),
                    discordId: DiscordAccountIdSchema.parse(
                      participant.discordId,
                    ),
                    team,
                  }),
                  props,
                );
              }}
              type="button"
            >
              {team}
            </button>
          ))
        : null}
    </span>
  ));
}

export function DraftControls(props: GameControlProps & { manager: boolean }) {
  const trpc = useTRPC();
  const randomTeams = useMutation(
    trpc.customs.randomizeTeams.mutationOptions(),
  );
  const undo = useMutation(trpc.customs.undoPick.mutationOptions());
  const lock = useMutation(trpc.customs.lockTeams.mutationOptions());
  const completeTeams =
    props.game.participants.filter((participant) => participant.team === "A")
      .length === 5 &&
    props.game.participants.filter((participant) => participant.team === "B")
      .length === 5;
  const drafting = ["CAPTAINS_SET", "DRAFTING"].includes(props.game.state);

  return (
    <div className="button-row">
      {props.manager && props.game.state === "ROSTER_OPEN" ? (
        <CaptainControls {...props} />
      ) : null}
      {props.manager && props.game.state === "CAPTAINS_SET" ? (
        <button
          className="button primary"
          onClick={() => {
            void runSnapshotAction(
              randomTeams.mutateAsync(revision(props.snapshot)),
              props,
            );
          }}
          type="button"
        >
          Randomize teams
        </button>
      ) : null}
      {drafting ? <UnassignedPlayerControls {...props} /> : null}
      {props.manager && props.game.state === "DRAFTING" ? (
        <button
          className="button subtle"
          onClick={() => {
            void runSnapshotAction(
              undo.mutateAsync(revision(props.snapshot)),
              props,
            );
          }}
          type="button"
        >
          Undo pick
        </button>
      ) : null}
      {completeTeams && drafting && props.manager ? (
        <button
          className="button primary"
          onClick={() => {
            void runSnapshotAction(
              lock.mutateAsync(revision(props.snapshot)),
              props,
            );
          }}
          type="button"
        >
          Create tournament lobby
        </button>
      ) : null}
    </div>
  );
}
