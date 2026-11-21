import { useEffect, useId, useRef, useState } from "react";
import {
  SubtitleMenuSchema,
  type WebRoomPlayer,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { z } from "zod";
import {
  apiRequest,
  postJson,
  type ApiFailure,
} from "@shepherdjerred/streambot/web/client/api.ts";
import { playerCommand } from "@shepherdjerred/streambot/web/client/commands.ts";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { FailureNotice } from "@shepherdjerred/streambot/web/client/failure-notice.tsx";
import {
  NO_VOICE,
  useRemote,
} from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import "@shepherdjerred/streambot/web/client/styles/dialog.css";

type Menu = z.infer<typeof SubtitleMenuSchema>;

/**
 * Lists the current video's subtitle tracks and applies one. The list is tied to the revision it
 * was read at; if playback changes first, the server refuses the choice and says so here.
 */
export function SubtitlesDialog(props: {
  player: WebRoomPlayer;
  onClose: () => void;
}) {
  const remote = useRemote();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const apply = useControl();
  const { slot } = props.player;
  const latest = useRef(remote);
  latest.current = remote;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const current = latest.current;
    const target = current.latestTarget();
    const player = current
      .latestRoom()
      ?.players.find((item) => item.slot === slot);
    if (target === null || player === undefined) {
      setFailure(NO_VOICE);
      return;
    }
    const controller = new AbortController();
    setFailure(null);
    const load = async () => {
      const result = await apiRequest(
        "/api/subtitles",
        SubtitleMenuSchema,
        postJson(
          playerCommand(target, player, {
            action: "subtitles",
            token: "enumerate",
          }),
          current.me.csrfToken,
          controller.signal,
        ),
      );
      if (controller.signal.aborted) return;
      if (result.ok) setMenu(result.data);
      else if (result.failure.code !== "aborted") setFailure(result.failure);
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [slot, attempt]);

  const submit = () => {
    if (menu === null || choice === null) return;
    apply.run(async (signal) => {
      const target = remote.latestTarget();
      if (target === null) return { ok: false, failure: NO_VOICE };
      const result = await remote.send(
        playerCommand(
          target,
          { slot, revision: menu.revision, current: props.player.current },
          { action: "subtitles", token: choice },
        ),
        signal,
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      dialog.current?.close();
      return { ok: true, message: result.data.message };
    });
  };

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      onClose={props.onClose}
    >
      <form
        method="dialog"
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id={titleId} className="dialog-title">
          Subtitles
        </h2>
        <p className="muted">{props.player.current?.title}</p>
        {failure !== null && (
          <p className="status">
            <FailureNotice
              surface="dialog"
              failure={failure}
              onRetry={() => {
                setAttempt((value) => value + 1);
              }}
            />
          </p>
        )}
        {menu === null && failure === null && (
          <p className="muted">Finding subtitle tracks…</p>
        )}
        {menu !== null && menu.tracks.length === 0 && (
          <p className="muted">This video has no subtitle tracks.</p>
        )}
        {menu !== null && menu.tracks.length > 0 && (
          <fieldset className="choices">
            <legend className="visually-hidden">Subtitle track</legend>
            {menu.tracks.map((track) => (
              <label key={track.token} className="choice">
                <input
                  type="radio"
                  name="track"
                  value={track.token}
                  checked={choice === track.token}
                  onChange={() => {
                    setChoice(track.token);
                  }}
                />
                {track.label}
              </label>
            ))}
          </fieldset>
        )}
        <ControlStatus surface="dialog" control={apply} />
        <div className="dialog-actions btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-watch"
            aria-busy={apply.pending}
            disabled={choice === null || apply.pending}
          >
            Use these subtitles
          </button>
        </div>
      </form>
    </dialog>
  );
}
