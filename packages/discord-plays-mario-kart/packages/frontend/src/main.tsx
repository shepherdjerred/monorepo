import { mountGameApp } from "@shepherdjerred/discord-plays-web/bootstrap/mount-game-app.tsx";
import { App } from "./app.tsx";
import "./index.css";

mountGameApp({
  sentryDsn: "https://c2f90a5857e940e1997b49791d9fc684@bugsink.sjer.red/13",
  app: <App />,
});
