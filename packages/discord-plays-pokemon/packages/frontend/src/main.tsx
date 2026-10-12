import { mountGameApp } from "@shepherdjerred/discord-plays-web/bootstrap/mount-game-app.tsx";
import { App } from "./app.tsx";
import "./index.css";

mountGameApp({
  sentryDsn: "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  app: <App />,
});
