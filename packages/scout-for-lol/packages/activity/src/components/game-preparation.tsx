import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CustomRosterModeSchema,
  DiscordAccountIdSchema,
} from "@scout-for-lol/data";
import { useTRPC } from "@/lib/activity-api";
import {
  type ActivityControlProps,
  type GameControlProps,
  revision,
  runSnapshotAction,
  StatePill,
} from "@/components/activity-shared";

export function PrepareRosterControls(props: ActivityControlProps) {
  const trpc = useTRPC();
  const prepareGame = useMutation(trpc.customs.prepareGame.mutationOptions());
  const [rosterMode, setRosterMode] = useState<
    "FIRST_TEN" | "HOST_SELECTED" | "RANDOM_TEN"
  >("FIRST_TEN");
  const [selectedRoster, setSelectedRoster] = useState<string[]>([]);
  const rosterCandidates = props.snapshot.participants.filter(
    (participant) =>
      participant.playerId !== null && participant.selectedAccountId !== null,
  );
  const prepare = (): void => {
    void runSnapshotAction(
      prepareGame.mutateAsync({
        ...revision(props.snapshot),
        rosterMode,
        selectedDiscordIds: selectedRoster.map((id) =>
          DiscordAccountIdSchema.parse(id),
        ),
        map: "SUMMONERS_RIFT",
        pickMode: "TOURNAMENT_DRAFT",
      }),
      props,
    );
  };

  return (
    <section className="panel action-panel">
      <h2>Prepare roster</h2>
      <label>
        Roster mode
        <select
          className="text-input"
          onChange={(event) => {
            setRosterMode(CustomRosterModeSchema.parse(event.target.value));
          }}
          value={rosterMode}
        >
          <option value="FIRST_TEN">First ten ready</option>
          <option value="RANDOM_TEN">Random ten</option>
          <option value="HOST_SELECTED">Host selected</option>
        </select>
      </label>
      {rosterMode === "HOST_SELECTED" ? (
        <div className="player-grid">
          {rosterCandidates.map((participant) => (
            <label className="player-card" key={participant.discordId}>
              <input
                checked={selectedRoster.includes(participant.discordId)}
                onChange={(event) => {
                  setSelectedRoster((current) =>
                    event.target.checked
                      ? [...current, participant.discordId]
                      : current.filter((id) => id !== participant.discordId),
                  );
                }}
                type="checkbox"
              />
              {participant.displayName}
            </label>
          ))}
        </div>
      ) : null}
      <button className="button primary" onClick={prepare} type="button">
        Lock roster
      </button>
    </section>
  );
}

export function IntermissionControls(props: GameControlProps) {
  const trpc = useTRPC();
  const continueNight = useMutation(
    trpc.customs.continueNight.mutationOptions(),
  );
  const choices = [
    ["KEEP_TEAMS_AND_CAPTAINS", "Keep teams and captains"],
    ["KEEP_TEAMS_REROLL_CAPTAINS", "Keep teams, new captains"],
    ["REDRAFT_SAME_CAPTAINS", "Redraft, same captains"],
    ["REDRAFT_NEW_CAPTAINS", "Redraft, new captains"],
  ] as const;

  return (
    <section className="panel action-panel">
      <div className="section-heading">
        <h2>Game {props.game.sequence.toString()} complete</h2>
        <StatePill state="INTERMISSION" />
      </div>
      <p>
        Choose how game {(props.game.sequence + 1).toString()} should begin.
      </p>
      <div className="button-row">
        {choices.map(([choice, label]) => (
          <button
            className="button primary"
            key={choice}
            onClick={() => {
              void runSnapshotAction(
                continueNight.mutateAsync({
                  ...revision(props.snapshot),
                  choice,
                }),
                props,
              );
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
