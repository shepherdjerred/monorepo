import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { z } from "zod";
import {
  CommandResultSchema,
  MeSchema,
  SnapshotSchema,
  SubtitleMenuSchema,
  type WebSnapshot,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  api,
  ApiError,
  playerCommandRequest,
  type RemoteAction,
} from "./api.ts";
import { resolveChannelDeepLink, selectedGuildId } from "./route-state.ts";
import { QueueLoadSchema } from "@shepherdjerred/streambot/music/contracts.ts";

export function useRemote() {
  const [me, setMe] = useState<z.infer<typeof MeSchema> | null>(null);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const guildId = selectedGuildId(me?.guilds ?? [], params.get("guild"));
  const requestedChannel = params.get("channel");
  const pendingAction = useRef<AbortController | null>(null);
  const [snapshotState, setSnapshotState] = useState<{
    guildId: string;
    snapshot: WebSnapshot;
  } | null>(null);
  const snapshot =
    snapshotState?.guildId === guildId ? snapshotState.snapshot : null;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadId, setLoadId] = useState<string | null>(null);
  const [queueLoad, setQueueLoad] = useState<z.infer<
    typeof QueueLoadSchema
  > | null>(null);
  const [tracks, setTracks] = useState<z.infer<
    typeof SubtitleMenuSchema
  > | null>(null);

  const setGuildId = (id: string) => {
    pendingAction.current?.abort();
    pendingAction.current = null;
    setBusy(false);
    setLoadId(null);
    setQueueLoad(null);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("guild", id);
      next.delete("channel");
      return next;
    });
  };

  useEffect(() => {
    if (me === null) return;
    if (requestedChannel !== null && me.guilds.length === 0) {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete("channel");
          return next;
        },
        { replace: true },
      );
      return;
    }
    if (guildId !== "" && params.get("guild") !== guildId) {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (previous.has("guild")) next.delete("channel");
          next.set("guild", guildId);
          return next;
        },
        { replace: true },
      );
    }
  }, [me, params, guildId, requestedChannel, setParams]);
  useEffect(() => {
    pendingAction.current?.abort();
    pendingAction.current = null;
    setBusy(false);
    return () => {
      pendingAction.current?.abort();
    };
  }, [guildId]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadIdentity() {
      try {
        const identity = await api("/api/me", MeSchema, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setMe(identity);
      } catch (error_) {
        if (
          !controller.signal.aborted &&
          !(error_ instanceof ApiError && error_.status === 401)
        )
          setError(
            error_ instanceof Error
              ? error_.message
              : "Sign-in is unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadIdentity();
    return () => {
      controller.abort();
      pendingAction.current?.abort();
    };
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (guildId === "") return;
      const next = await api(
        "/api/player?" + new URLSearchParams({ guildId }).toString(),
        SnapshotSchema,
        signal === undefined ? undefined : { signal },
      );
      if (signal?.aborted !== true)
        setSnapshotState({ guildId, snapshot: next });
    },
    [guildId],
  );

  useEffect(() => {
    if (loadId === null || guildId === "") return;
    const controller = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const load = await api(
          "/api/music/load?" +
            new URLSearchParams({ guildId, id: loadId }).toString(),
          QueueLoadSchema,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setQueueLoad(load);
        if (load.state !== "loading") {
          setLoadId(null);
          setNotice(load.message);
          await refresh(controller.signal);
        }
      } catch (error_) {
        if (!controller.signal.aborted) {
          setError(
            error_ instanceof Error
              ? error_.message
              : "Playlist loading was interrupted.",
          );
          setLoadId(null);
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [loadId, guildId, refresh]);

  useEffect(() => {
    if (me === null || guildId === "") return;
    const controller = new AbortController();
    setSnapshotState(null);
    setTracks(null);
    setError("");
    setNotice("");
    let polling = false;
    async function poll(initial = false) {
      if (polling || (!initial && document.hidden)) return;
      polling = true;
      try {
        await refresh(controller.signal);
      } catch (error_) {
        if (!controller.signal.aborted) {
          setError(
            error_ instanceof Error ? error_.message : "Connection lost.",
          );
          setSnapshotState(null);
          if (error_ instanceof ApiError && error_.status === 401) setMe(null);
        }
      } finally {
        polling = false;
      }
    }
    void poll(true);
    const timer = setInterval(() => {
      void poll();
    }, 2000);
    function onVisibility() {
      void poll();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [me, guildId, refresh]);

  function finishAction(controller: AbortController) {
    if (pendingAction.current !== controller) return;
    pendingAction.current = null;
    setBusy(false);
  }

  function actionIsCurrent(controller: AbortController) {
    return pendingAction.current === controller && !controller.signal.aborted;
  }

  const send = useCallback(
    async (action: RemoteAction): Promise<void> => {
      if (
        me === null ||
        pendingAction.current !== null ||
        snapshot?.channel == null
      )
        return;
      const controller = new AbortController();
      pendingAction.current = controller;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const result = await api("/api/commands", CommandResultSchema, {
          ...playerCommandRequest(action, guildId, snapshot, me.csrfToken),
          signal: controller.signal,
        });
        if (!actionIsCurrent(controller)) return;
        setNotice(result.message);
        if (result.loadId !== undefined) {
          setQueueLoad(null);
          setLoadId(result.loadId);
        }
        setTracks(null);
        await refresh(controller.signal);
      } catch (error_) {
        if (!actionIsCurrent(controller)) return;
        setError(
          error_ instanceof Error ? error_.message : "The action failed.",
        );
        try {
          await refresh(controller.signal);
        } catch {
          if (actionIsCurrent(controller)) setSnapshotState(null);
        }
      } finally {
        finishAction(controller);
      }
    },
    [me, guildId, snapshot, refresh],
  );

  useEffect(() => {
    if (
      me === null ||
      guildId === "" ||
      snapshot === null ||
      requestedChannel === null ||
      busy ||
      params.get("guild") !== guildId
    )
      return;
    const target = resolveChannelDeepLink(requestedChannel, snapshot);
    if (target !== null) void send({ action: "select", number: target });
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("channel");
        return next;
      },
      { replace: true },
    );
  }, [me, guildId, params, snapshot, requestedChannel, busy, send, setParams]);

  async function openSubtitles(): Promise<void> {
    if (
      me === null ||
      pendingAction.current !== null ||
      snapshot?.channel == null
    )
      return;
    const controller = new AbortController();
    pendingAction.current = controller;
    setBusy(true);
    setError("");
    try {
      const menu = await api("/api/subtitles", SubtitleMenuSchema, {
        ...playerCommandRequest(
          { action: "subtitles", token: "enumerate" },
          guildId,
          snapshot,
          me.csrfToken,
        ),
        signal: controller.signal,
      });
      if (actionIsCurrent(controller)) setTracks(menu);
    } catch (error_) {
      if (!actionIsCurrent(controller)) return;
      setError(
        error_ instanceof Error
          ? error_.message
          : "Subtitles could not be loaded.",
      );
    } finally {
      finishAction(controller);
    }
  }

  async function logout(): Promise<void> {
    if (me === null) return;
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": me.csrfToken },
      });
      if (!response.ok)
        throw new Error("Sign out failed. Refresh and try again.");
      globalThis.location.assign("/");
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Sign out failed.");
    }
  }
  async function cancelLoad(): Promise<void> {
    if (me === null || loadId === null) return;
    try {
      const load = await api(
        "/api/music/load?" +
          new URLSearchParams({ guildId, id: loadId }).toString(),
        QueueLoadSchema,
        { method: "POST", headers: { "x-csrf-token": me.csrfToken } },
      );
      setQueueLoad(load);
      setLoadId(null);
      setNotice(load.message);
    } catch (error_) {
      setError(
        error_ instanceof Error
          ? error_.message
          : "Could not cancel the request.",
      );
    }
  }

  return {
    me,
    loading,
    guildId,
    setGuildId,
    snapshot,
    error,
    notice,
    busy,
    queueLoad,
    loadingPlaylist: loadId !== null,
    cancelLoad,
    tracks,
    setTracks,
    send,
    openSubtitles,
    logout,
    clearFeedback: () => {
      setError("");
      setNotice("");
    },
  };
}
