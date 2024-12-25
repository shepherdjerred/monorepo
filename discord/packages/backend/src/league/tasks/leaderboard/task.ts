// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { toLeaderboard } from "./index.ts";
import { getPlayer } from "../../model/player.ts";
import {
  CopyObjectCommand,
  PutObjectCommand,
} from "https://esm.sh/@aws-sdk/client-s3@3.461.0";
import configuration from "../../../configuration.ts";
import { s3 } from "../../s3.ts";
import { getPlayerConfigs } from "../../playerConfig.ts";
import { format } from "npm:date-fns@2.30.0";
import { send } from "../../discord/channel.ts";
import { leaderboardToDiscordMessage, setKing } from "./discord.ts";
import { Leaderboard } from "@discord/data";

const link = "https://discord.com/leaderboard/";

async function uploadLeaderboard(leaderboard: Leaderboard) {
  const copyCommand = new CopyObjectCommand({
    Bucket: configuration.s3BucketName,
    CopySource: `${configuration.s3BucketName}/leaderboard.json`,
    Key: `previous.json`,
    ContentType: "application/json",
  });
  await s3.send(copyCommand);

  let putCommand = new PutObjectCommand({
    Bucket: configuration.s3BucketName,
    Key: `leaderboard.json`,
    Body: JSON.stringify(leaderboard),
    ContentType: "application/json",
  });
  await s3.send(putCommand);
  const date = format(new Date(), "yyyy-MM-dd");
  putCommand = new PutObjectCommand({
    Bucket: configuration.s3BucketName,
    Key: `leaderboards/${date}.json`,
    Body: JSON.stringify(leaderboard),
    ContentType: "application/json",
  });
  await s3.send(putCommand);
}

export async function postLeaderboardMessage() {
  const playerConfigs = await getPlayerConfigs();
  const players = await Promise.all(_.map(playerConfigs, getPlayer));
  const leaderboard = toLeaderboard(players);
  const message = leaderboardToDiscordMessage(leaderboard);
  const messageWithLink = `View more details at ${link}\n${message}`;
  await send(messageWithLink);

  await uploadLeaderboard(leaderboard);

  const king = _.first(leaderboard.contents);

  if (king !== undefined) {
    await setKing(king.player.config);
  }
}
