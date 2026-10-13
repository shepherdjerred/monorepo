import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ResponseSchema } from "@discord-plays-pokemon/common";
import { EMPTY_GAME, reduceGame, type Game } from "./game.ts";
import { socket } from "./socket.ts";

/** Attach listeners before requesting recovery, including an already-connected socket. */
export function listenToGame(
  setGame: Dispatch<SetStateAction<Game>>,
): () => void {
  const onConnect = () => {
    setGame({ ...EMPTY_GAME, connected: true });
    socket.emit("request", { kind: "snapshot" });
  };
  const onDisconnect = () => {
    setGame(EMPTY_GAME);
  };
  const onResponse = (raw: unknown) => {
    const response = ResponseSchema.parse(raw);
    setGame((current) => reduceGame(current, response));
  };
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("response", onResponse);
  if (socket.connected) onConnect();
  const poll = globalThis.setInterval(() => {
    if (socket.connected) socket.emit("request", { kind: "status" });
  }, 3000);
  return () => {
    globalThis.clearInterval(poll);
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("response", onResponse);
  };
}

/** One response listener: command results have no request ID to correlate. */
export function useGame() {
  const [game, setGame] = useState(EMPTY_GAME);
  // Synchronize Socket.IO listeners and release them when this page unmounts.
  useEffect(() => listenToGame(setGame), []);
  return game;
}
