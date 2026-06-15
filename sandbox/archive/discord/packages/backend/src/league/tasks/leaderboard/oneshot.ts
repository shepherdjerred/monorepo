import client from "../../../discord/client.ts";
import { postLeaderboardMessage } from "./task.ts";

await postLeaderboardMessage();
await client.destroy();
