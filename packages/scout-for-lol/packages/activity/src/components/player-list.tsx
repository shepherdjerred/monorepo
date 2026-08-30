import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AccountIdSchema, DiscordAccountIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "@/lib/activity-api";
import {
  type ActivityControlProps,
  revision,
  runSnapshotAction,
} from "@/components/activity-shared";

export function PlayerList(props: ActivityControlProps) {
  const trpc = useTRPC();
  const availability = useMutation(
    trpc.customs.setAvailability.mutationOptions(),
  );
  const account = useMutation(trpc.customs.selectAccount.mutationOptions());
  const held = useMutation(trpc.customs.setHeld.mutationOptions());
  const away = useMutation(trpc.customs.setAway.mutationOptions());
  const cohost = useMutation(trpc.customs.setCohost.mutationOptions());
  const addParticipant = useMutation(
    trpc.customs.addParticipant.mutationOptions(),
  );
  const removeParticipant = useMutation(
    trpc.customs.removeParticipant.mutationOptions(),
  );
  const [newParticipantId, setNewParticipantId] = useState("");
  const manager = ["HOST", "COHOST", "ADMIN"].includes(
    props.snapshot.viewerRole,
  );
  const run = (action: Promise<ActivityControlProps["snapshot"]>): void => {
    void runSnapshotAction(action, props);
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Players</h2>
        <span>{props.snapshot.participants.length.toString()} joined</span>
      </div>
      <div className="player-grid">
        {props.snapshot.participants.map((participant) => (
          <article className="player-card" key={participant.discordId}>
            <div>
              <strong>{participant.displayName}</strong>
              <p>
                {participant.availability.replaceAll("_", " ")}
                {participant.held ? " · held" : ""}
              </p>
            </div>
            {participant.discordId === props.viewerId ? (
              <div className="button-row">
                {(["READY", "MAYBE", "SITTING_OUT"] as const).map((value) => (
                  <button
                    className="button subtle"
                    key={value}
                    onClick={() => {
                      run(
                        availability.mutateAsync({
                          ...revision(props.snapshot),
                          availability: value,
                        }),
                      );
                    }}
                    type="button"
                  >
                    {value.replaceAll("_", " ")}
                  </button>
                ))}
                {participant.accounts.map((candidate) => (
                  <button
                    className="button subtle"
                    key={candidate.accountId}
                    onClick={() => {
                      run(
                        account.mutateAsync({
                          ...revision(props.snapshot),
                          accountId: AccountIdSchema.parse(candidate.accountId),
                        }),
                      );
                    }}
                    type="button"
                  >
                    {candidate.riotGameName ?? "Riot account"}
                    {participant.selectedAccountId === candidate.accountId
                      ? " ✓"
                      : ""}
                  </button>
                ))}
                <button
                  className="button subtle"
                  onClick={() => {
                    run(
                      away.mutateAsync({
                        ...revision(props.snapshot),
                        awayUntil:
                          participant.awayUntil === null
                            ? new Date(Date.now() + 10 * 60_000).toISOString()
                            : null,
                      }),
                    );
                  }}
                  type="button"
                >
                  {participant.awayUntil === null ? "Away 10 min" : "I’m back"}
                </button>
              </div>
            ) : null}
            {manager &&
            participant.discordId !== props.snapshot.hostDiscordId ? (
              <div className="button-row">
                <button
                  className="button subtle"
                  onClick={() => {
                    run(
                      held.mutateAsync({
                        ...revision(props.snapshot),
                        discordId: DiscordAccountIdSchema.parse(
                          participant.discordId,
                        ),
                        held: !participant.held,
                      }),
                    );
                  }}
                  type="button"
                >
                  {participant.held ? "Release hold" : "Hold spot"}
                </button>
                {props.snapshot.currentGame?.participants.some(
                  (gameParticipant) =>
                    gameParticipant.discordId === participant.discordId,
                ) === true ? null : (
                  <button
                    className="button danger"
                    onClick={() => {
                      run(
                        removeParticipant.mutateAsync({
                          ...revision(props.snapshot),
                          discordId: DiscordAccountIdSchema.parse(
                            participant.discordId,
                          ),
                        }),
                      );
                    }}
                    type="button"
                  >
                    Remove player
                  </button>
                )}
                <button
                  className="button subtle"
                  onClick={() => {
                    run(
                      cohost.mutateAsync({
                        ...revision(props.snapshot),
                        discordId: DiscordAccountIdSchema.parse(
                          participant.discordId,
                        ),
                        cohost: !props.snapshot.cohostDiscordIds.includes(
                          participant.discordId,
                        ),
                      }),
                    );
                  }}
                  type="button"
                >
                  {props.snapshot.cohostDiscordIds.includes(
                    participant.discordId,
                  )
                    ? "Remove cohost"
                    : "Make cohost"}
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {manager && props.snapshot.state === "RECRUITING" ? (
        <form
          className="button-row"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              addParticipant.mutateAsync({
                ...revision(props.snapshot),
                discordId: DiscordAccountIdSchema.parse(newParticipantId),
              }),
            );
            setNewParticipantId("");
          }}
        >
          <label>
            Add Discord member ID
            <input
              className="text-input"
              onChange={(event) => {
                setNewParticipantId(event.target.value);
              }}
              required
              value={newParticipantId}
            />
          </label>
          <button className="button subtle" type="submit">
            Add player
          </button>
        </form>
      ) : null}
    </section>
  );
}
