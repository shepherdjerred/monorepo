import { Notifications } from "./stories/notifications.tsx";
import type { Notification } from "./model/notification.tsx";
import lodash from "lodash";
import { useState } from "react";
import { Container } from "./stories/container.tsx";
import { P, match } from "ts-pattern";
import { GamePage } from "./pages/game-page.tsx";
import { LoginPage } from "./pages/login-page.tsx";
import { useInterval } from "react-use";
import type { Connection } from "./model/connection.tsx";
import { socket } from "./socket.tsx";
import type {
  CommandRequest,
  LoginRequest,
  Player,
  ScreenshotRequest,
  Status} from "@discord-plays-pokemon/common";

export function App() {
  const [player, _setPlayer] = useState<Player>();
  const [status, _setStatus] = useState<Status>({
    playerList: [],
  });
  const [connection, setConnection] = useState<Connection>({
    status: "connecting",
    latency: undefined,
  });
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useInterval(() => {
    const start = Date.now();

    socket.emit("ping", () => {
      const duration = Date.now() - start;
      setConnection((prev) => ({
        ...prev,
        latency: duration,
      }));
    });
  }, 2000);

  function handleLogin(token: string) {
    console.log("logging in with:", token);

    const loginRequest: LoginRequest = { kind: "login", value: { token } };
    socket.emit("request", loginRequest);
  }

  function handleKeyPress(key: string) {
    console.log(key);
    const request: CommandRequest = {
      kind: "command",
      value: key,
    };
    socket.emit("request", request);
  }

  function handleNotificationClose(id: string) {
    setNotifications((prev) =>
      lodash.filter(prev, (notification) => notification.id !== id),
    );
  }

  function handleScreenshot() {
    console.log("screenshot");
    const request: ScreenshotRequest = {
      kind: "screenshot",
    };
    socket.emit("request", request);
  }

  const page = match(player)
    .with(P.not(P.nullish), (player) => {
      return (
        <GamePage
          status={status}
          connection={connection}
          onKey={handleKeyPress}
          onScreenshot={handleScreenshot}
          player={player}
        />
      );
    })
    .with(P.nullish, () => {
      return <LoginPage handleLogin={handleLogin} />;
    })
    .exhaustive();

  return (
    <>
      <div className="bg-white dark:bg-slate-900 min-h-screen min-w-full">
        <Container>
          <div className="flex flex-col justify-center h-full gap-y-5">
            {page}
          </div>
        </Container>
      </div>
      <Notifications
        notifications={notifications}
        onClose={handleNotificationClose}
      />
    </>
  );
}
