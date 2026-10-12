import { defineConfig } from "@shepherdjerred/config";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { z } from "zod";
import manifest from "#config/forum.json";
import { SeasonChoiceSchema } from "@shepherdjerred/storm-theme";

const NodeSchema = z
  .object({
    key: z.string().regex(/^[a-z]+$/),
    title: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(["Category", "Forum"]),
    parent: z.string().optional(),
    access: z
      .enum(["public", "announcements", "author-staff", "staff"])
      .optional(),
    article: z.boolean().optional(),
    countMessages: z.boolean().optional(),
  })
  .strict();
const StageConfigSchema = z
  .object({ url: z.url(), taskQueue: z.string().min(1) })
  .strict();
export const StageSchema = z.enum(["beta", "prod"]);
export type Stage = z.infer<typeof StageSchema>;
export const ManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    xenforoVersion: z.literal("2.3.13"),
    title: z.string(),
    joinAddress: z.string(),
    smtpHost: z.string(),
    smtpPort: z.number().int().positive(),
    sender: z.email(),
    stages: z
      .object({ beta: StageConfigSchema, prod: StageConfigSchema })
      .strict(),
    minecraft: z
      .object({
        namespace: z.string(),
        statefulSet: z.string(),
        host: z.string(),
        queryPort: z.number().int().min(1).max(65_535),
        bedrockPort: z.number().int().min(1).max(65_535),
        connections: z
          .object({
            java: z
              .object({
                address: z.string().min(1),
                host: z.string().min(1),
                port: z.number().int().min(1).max(65_535),
              })
              .strict(),
            bedrock: z
              .object({
                host: z.string().min(1),
                port: z.number().int().min(1).max(65_535),
              })
              .strict(),
          })
          .strict(),
        timeoutMs: z.number().positive(),
        staleAfterSeconds: z.number().positive(),
      })
      .strict(),
    registration: z
      .object({
        approvedPosts: z.literal(3),
        accountAgeHours: z.literal(24),
        timerSeconds: z.number().int().positive(),
      })
      .strict(),
    attachmentLimitKiB: z.literal(5120),
    reactions: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z]+$/),
            title: z.string().min(1),
            emoji: z.string().min(1),
            score: z.number().int().min(-1).max(1),
          })
          .strict(),
      )
      .min(1),
    nodes: z.array(NodeSchema).min(1),
    vendorDependencies: z.array(
      z.discriminatedUnion("kind", [
        z
          .object({
            key: z.string(),
            version: z.string(),
            kind: z.literal("addon"),
            path: z.string(),
          })
          .strict(),
        z
          .object({
            key: z.string(),
            version: z.string().regex(/^\d+\.\d+\.\d+$/),
            kind: z.literal("style"),
            path: z.string().regex(/^vendor\/[\w-]+\.zip$/),
            mode: z.enum(["light", "dark"]),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      ]),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    const styles = value.vendorDependencies.filter(
      (dependency) => dependency.kind === "style",
    );
    if (
      styles.length !== 2 ||
      new Set(styles.map((style) => style.mode)).size !== 2
    ) {
      context.addIssue({
        code: "custom",
        message: "Exactly one pinned light and dark parent style is required",
      });
    }
    const keys = new Set<string>();
    if (
      new Set(value.reactions.map((reaction) => reaction.key)).size !==
        value.reactions.length ||
      value.reactions[0]?.key !== "like"
    ) {
      context.addIssue({
        code: "custom",
        message: "Reaction keys must be unique with Like first",
      });
    }
    for (const node of value.nodes) {
      if (
        keys.has(node.key) ||
        (node.parent !== undefined && !keys.has(node.parent))
      ) {
        context.addIssue({
          code: "custom",
          message: `Duplicate node or missing preceding parent: ${node.key}`,
        });
      }
      if (node.type === "Forum" && node.access === undefined) {
        context.addIssue({
          code: "custom",
          message: `Forum requires explicit access: ${node.key}`,
        });
      }
      keys.add(node.key);
    }
    // Polling mc-router would wake a hibernated server. Reject any host outside the backend namespace.
    if (
      !value.minecraft.host.endsWith(
        `.${value.minecraft.namespace}.svc.cluster.local`,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Minecraft status must use the direct cluster backend",
      });
    }
  });
export const forumManifest = ManifestSchema.parse(manifest);

export function createForumConfig(flagSource?: ConfigSource) {
  return defineConfig({
    definition: {
      registrationEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "storm-forum-registration-enabled" },
      },
      season: {
        schema: SeasonChoiceSchema,
        sources: ["flag", "default"],
        default: "auto",
        names: { flag: "storm-forum-season" },
      },
      calendarEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "storm-forum-calendar-enabled" },
      },
    } as const,
    sources: flagSource === undefined ? {} : { flag: flagSource },
  });
}

export function forumFlagOptions(stage: Stage) {
  return {
    targetingKey: "storm-forum",
    attributes: { stage },
    kinds: {
      registrationEnabled: "boolean",
      season: "string",
      calendarEnabled: "boolean",
    } as const,
  };
}
