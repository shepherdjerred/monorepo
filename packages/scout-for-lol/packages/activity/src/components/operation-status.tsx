import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DiscordChannelIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "@/lib/activity-api";
import {
  revision,
  runSnapshotAction,
  type ActivityControlProps,
} from "@/components/activity-shared";

function operationHeading(held: boolean, cleanup: boolean) {
  if (!held) return "Updating this night";
  return cleanup
    ? "Expired night needs voice cleanup"
    : "Voice setup needs a check";
}

function resolutionLabel(hasChannel: boolean, cleanup: boolean) {
  if (cleanup) {
    return hasChannel
      ? "Record channel and clean up"
      : "Confirm no channel and clean up";
  }
  return hasChannel
    ? "Use this channel and resume"
    : "Confirm no channel and retry";
}

export function CustomOperationStatus(props: ActivityControlProps) {
  const trpc = useTRPC();
  const resolution = useMutation(
    trpc.customs.resolveVoiceOperation.mutationOptions(),
  );
  const [channelId, setChannelId] = useState("");
  const [evidence, setEvidence] = useState("");
  const pending = props.snapshot.pendingOperation;
  if (pending === undefined || pending === null) return null;
  const manager = ["HOST", "COHOST", "ADMIN"].includes(
    props.snapshot.viewerRole,
  );
  const held = pending.state === "held";
  const cleanup =
    props.snapshot.state === "ENDED" && pending.action === "expire";
  const channel =
    channelId.trim() === ""
      ? undefined
      : DiscordChannelIdSchema.safeParse(channelId.trim());
  return (
    <section className="panel operation-status" aria-label="Night operation">
      <h2>{operationHeading(held, cleanup)}</h2>
      <p role="status" aria-live="polite">
        {pending.step}
      </p>
      {held ? (
        <p>
          Check this server’s team voice channels. The host or a cohost can
          record the channel Scout created, or confirm that none exists. Scout
          verifies the channels before continuing.
          {cleanup
            ? " This night has ended. Scout will only return players and remove its team channels."
            : null}
        </p>
      ) : (
        <p>
          Scout will resume this operation if its connection is interrupted.
          Night controls become available when it finishes.
        </p>
      )}
      {held && manager ? (
        <form
          className="operation-resolution"
          onSubmit={(event) => {
            event.preventDefault();
            if (channel !== undefined && !channel.success) return;
            void runSnapshotAction(
              resolution.mutateAsync({
                ...revision(props.snapshot),
                operationId: pending.id,
                evidence: evidence.trim(),
                answer:
                  channel === undefined
                    ? { kind: "confirmed-unsent" }
                    : { kind: "channel-created", channelId: channel.data },
              }),
              props,
            );
          }}
        >
          <label>
            Created team channel ID (leave empty if none exists)
            <input
              className="text-input"
              inputMode="numeric"
              autoComplete="off"
              value={channelId}
              onChange={(event) => {
                setChannelId(event.target.value);
              }}
            />
          </label>
          <label>
            Describe what you checked
            <textarea
              className="text-input"
              rows={3}
              value={evidence}
              minLength={20}
              maxLength={1000}
              required
              onChange={(event) => {
                setEvidence(event.target.value);
              }}
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={
              resolution.isPending ||
              evidence.trim().length < 20 ||
              (channel !== undefined && !channel.success)
            }
          >
            {resolutionLabel(channel !== undefined, cleanup)}
          </button>
        </form>
      ) : null}
    </section>
  );
}
