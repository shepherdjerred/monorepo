import { z } from "zod";
import type {
  ArenaMatch,
  ClassicMatch,
  CompletedMatch,
  MatchId,
} from "@scout-for-lol/data/index.ts";
import { isClassicQueueType } from "@scout-for-lol/data/index.ts";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import {
  arenaMatchToSvg,
  classicMatchToSvg,
  matchToSvg,
  svgToPng,
} from "@scout-for-lol/report";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import { saveImageToS3, saveSvgToS3 } from "#src/storage/s3.ts";

const logger = createLogger("postmatch-match-report-image");

/**
 * The message furniture for one report image: the attachment and the embed
 * that displays it.
 */
function attachReportImage(
  image: Uint8Array,
  matchId: MatchId,
): [AttachmentBuilder, EmbedBuilder] {
  const attachmentName = `${matchId}.png`;
  const attachment = new AttachmentBuilder(Buffer.from(image)).setName(
    attachmentName,
  );
  const embed = new EmbedBuilder({
    image: { url: `attachment://${attachmentName}` },
  });
  return [attachment, embed];
}

/**
 * Create image attachments for Discord message.
 *
 * `prerenderedImage` is the seam the V2 notification lane uses: its render
 * Activity has already produced, committed and attested this match's PNG on
 * the background queue, and its delivery hands those verified bytes in here so
 * the send attaches exactly what was attested instead of rendering a second
 * time on the realtime queue. With it present nothing is rendered and nothing
 * is written to S3 — the bytes are already the stored object.
 */
export async function createMatchImage(
  matchToRender: CompletedMatch | ArenaMatch | ClassicMatch,
  matchId: MatchId,
  prerenderedImage: Uint8Array | undefined,
): Promise<[AttachmentBuilder, EmbedBuilder]> {
  if (prerenderedImage !== undefined) {
    return attachReportImage(prerenderedImage, matchId);
  }
  let svgData: string;
  if (matchToRender.queueType === "arena") {
    svgData = await arenaMatchToSvg(matchToRender);
  } else if ("mapName" in matchToRender) {
    if (!isClassicQueueType(matchToRender.queueType)) {
      throw new Error("Classic report model has a non-Classic queue type");
    }
    svgData = await classicMatchToSvg(matchToRender);
  } else {
    svgData = await matchToSvg(matchToRender, {
      // Keep the new ranked banner/square designs local-only until the
      // redesign is promoted.
      enableRankedDesigns: configuration.environment === "dev",
    });
  }
  const svg = z.string().parse(svgData);
  const image = z.instanceof(Uint8Array).parse(await svgToPng(svg));

  // Save both PNG and SVG to S3 (fire and forget)
  const queueTypeForStorage =
    matchToRender.queueType === "arena"
      ? "arena"
      : (matchToRender.queueType ?? "unknown");
  const trackedPlayerAliases = matchToRender.players.map(
    (p) => p.playerConfig.alias,
  );
  void (async () => {
    try {
      await Promise.all([
        saveImageToS3(
          matchId,
          image,
          queueTypeForStorage,
          trackedPlayerAliases,
        ),
        saveSvgToS3(matchId, svg, queueTypeForStorage, trackedPlayerAliases),
      ]);
    } catch (error) {
      logger.error(`[createMatchImage] Failed to save images to S3:`, error);
    }
  })();

  return attachReportImage(image, matchId);
}
