import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import {
  CommandResultSchema,
  MeSchema,
  SnapshotSchema,
  SubtitleMenuSchema,
  type WebSnapshot,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { api, ApiError, commandRequest, type RemoteAction } from "./api.ts";

export function useRemote() {
  const [me, setMe] = useState<z.infer<typeof MeSchema> | null>(null);
  const [loading, setLoading] = useState(true);
  const [guildId, setGuild] = useState("");
  const pendingAction = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<WebSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tracks, setTracks] = useState<z.infer<
    typeof SubtitleMenuSchema
  > | null>(null);

  const setGuildId = useCallback((id: string) => {
    pendingAction.current?.abort();
    pendingAction.current = null;
    setBusy(false);
    setGuild(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadIdentity() {
      try {
        const identity = await api("/api/me", MeSchema, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setMe(identity);
        setGuildId(identity.guilds[0]?.id ?? "");
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
  }, [setGuildId]);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (guildId === "") return;
      const next = await api(
        "/api/player?guildId=" + encodeURIComponent(guildId),
        SnapshotSchema,
        signal === undefined ? undefined : { signal },
      );
      if (signal?.aborted !== true) setSnapshot(next);
    },
    [guildId],
  );

  useEffect(() => {
    if (me === null || guildId === "") return;
    const controller = new AbortController();
    setSnapshot(null);
    setTracks(null);
    setError("");
    setNotice("");
    let polling = false;
    async function poll() {
      if (polling || document.hidden) return;
      polling = true;
      try {
        await refresh(controller.signal);
      } catch (error_) {
        if (!controller.signal.aborted) {
          setError(
            error_ instanceof Error ? error_.message : "Connection lost.",
          );
          setSnapshot(null);
          if (error_ instanceof ApiError && error_.status === 401) setMe(null);
        }
      } finally {
        polling = false;
      }
    }
    void poll();
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

  async function send(action: RemoteAction): Promise<void> {
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
        ...commandRequest(
          {
            ...action,
            guildId,
            channelId: snapshot.channel.id,
            revision: snapshot.revision,
            playbackChannel: snapshot.playbackChannel,
          },
          me.csrfToken,
        ),
        signal: controller.signal,
      });
      if (!actionIsCurrent(controller)) return;
      setNotice(result.message);
      setTracks(null);
      await refresh(controller.signal);
    } catch (error_) {
      if (!actionIsCurrent(controller)) return;
      setError(error_ instanceof Error ? error_.message : "The action failed.");
      try {
        await refresh(controller.signal);
      } catch {
        if (actionIsCurrent(controller)) setSnapshot(null);
      }
    } finally {
      finishAction(controller);
    }
  }

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
        ...commandRequest(
          {
            action: "subtitles",
            token: "enumerate",
            guildId,
            channelId: snapshot.channel.id,
            revision: snapshot.revision,
            playbackChannel: snapshot.playbackChannel,
          },
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

  return {
    me,
    loading,
    guildId,
    setGuildId,
    snapshot,
    error,
    notice,
    busy,
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
