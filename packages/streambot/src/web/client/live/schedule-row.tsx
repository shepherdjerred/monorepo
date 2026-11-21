import { CommandResultSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  apiRequest,
  postJson,
} from "@shepherdjerred/streambot/web/client/api.ts";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { MediaRow } from "@shepherdjerred/streambot/web/client/media/media-row.tsx";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";

/**
 * An upcoming game that can be scheduled: the same row as every other list, with Schedule in
 * place of the play buttons. Scheduling asks the server to start the game in the viewer's voice
 * channel once it is live, so it answers beside the button like any other action.
 */
export function ScheduleRow(props: {
  item: MediaItem;
  guildId: string;
  gameId: string;
  onScheduled: () => void;
}) {
  const { item } = props;
  const remote = useRemote();
  const control = useControl();
  const schedule = () => {
    control.run(async (signal) => {
      const result = await apiRequest(
        "/api/sports/schedules",
        CommandResultSchema,
        postJson(
          { guildId: props.guildId, selectionId: props.gameId },
          remote.me.csrfToken,
          signal,
        ),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      props.onScheduled();
      return { ok: true, message: result.data.message };
    });
  };
  return (
    <MediaRow
      item={item}
      actions={
        <>
          <div className="row-actions btn-row">
            <button
              type="button"
              className="btn"
              aria-disabled={control.pending}
              aria-busy={control.pending}
              onClick={() => {
                if (!control.pending) schedule();
              }}
            >
              {control.pending ? "Scheduling…" : "Schedule"}
              <span className="visually-hidden">: {item.title}</span>
            </button>
          </div>
          <ControlStatus
            surface="row"
            className="row-status"
            control={control}
          />
        </>
      }
    />
  );
}
