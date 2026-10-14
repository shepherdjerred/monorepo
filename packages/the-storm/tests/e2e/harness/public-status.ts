import { z } from "zod";
import contract from "@shepherdjerred/the-storm/public-status.json";

export const publicContract = z
  .strictObject({
    schemaVersion: z.literal(2),
    queryIdentity: z.string().min(1),
  })
  .parse(contract);

// The public wire bounds identity names, game IDs and game labels to 64 characters.
const Label = z.string().min(1).max(64);
const PlayerIdentity = z.strictObject({
  name: Label.regex(/^[^<>\p{Cc}]+$/u),
  uuid: z.uuid(),
});
const Metadata = z
  .strictObject({
    schemaVersion: z.literal(2),
    players: z.array(PlayerIdentity).max(100_000),
    games: z
      .array(
        z.strictObject({
          id: Label,
          kind: z.enum(["ARENA", "RWF"]),
          name: Label,
          phase: z.enum(["WAITING", "STARTING", "RUNNING"]),
          progress: z.string().max(32),
          players: z.array(z.uuid()).min(1).max(100_000),
        }),
      )
      .max(1000),
  })
  .superRefine((value, context) => {
    const names = new Set(value.players.map((player) => player.name));
    const ids = new Set(value.players.map((player) => player.uuid));
    if (
      names.size !== value.players.length ||
      ids.size !== value.players.length
    )
      context.addIssue({
        code: "custom",
        message: "Duplicate public player identity",
      });
    for (const game of value.games)
      if (new Set(game.players).size !== game.players.length)
        context.addIssue({
          code: "custom",
          message: "Duplicate public game participant",
        });
  });

/** Independently verifies Paper's sole application entry and canonical public wire encoding. */
export function publicQueryMetadata(plugins: string) {
  const wrapped = /^Paper on [^:;\p{Cc}]+: (?<application>[^;\p{Cc}]+) $/u.exec(
    plugins,
  );
  const application = z.string().parse(wrapped?.groups?.["application"]);
  const [identity, encoded] = z
    .tuple([
      z.literal(publicContract.queryIdentity),
      z.string().regex(/^[\w-]+$/u),
    ])
    .parse(application.split("|"));
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded)
    throw new Error("Noncanonical public Query metadata encoding");
  const decoded: unknown = JSON.parse(bytes.toString("utf8"));
  return { identity, metadata: Metadata.parse(decoded) };
}
