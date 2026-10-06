import { z } from "astro/zod";
import inventory from "../../homelab/src/cdk8s/src/resources/storm-forum/releases.json";

// Use the same declarative production activation as apex ingress ownership.
const releases = z
  .object({
    schemaVersion: z.literal(1),
    releases: z.array(z.looseObject({ stage: z.enum(["beta", "prod"]) })),
  })
  .strict()
  .parse(inventory).releases;

export const productionForumActive = releases.some(
  (release) => release.stage === "prod",
);
export const forumActive = import.meta.env.DEV || productionForumActive;
export const forumUrl = import.meta.env.DEV
  ? "http://127.0.0.1:18796"
  : "https://ts-mc.net";
