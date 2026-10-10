import { z } from "zod";
import contract from "@shepherdjerred/the-storm/public-status.json";

export const publicQueryContract = z
  .object({
    schemaVersion: z.literal(1),
    queryIdentity: z.string().min(1),
  })
  .strict()
  .parse(contract);

const MAGIC = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");
const QUERY_HEADER = Buffer.from("splitnum\0\u{80}\0", "latin1");
const PLAYER_MARKER = Buffer.from("\0\u{1}player_\0\0", "latin1");
const PlayerName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^<>]+$/u)
  .regex(/^\P{Cc}+$/u);
export const PublicPlayersSchema = z
  .object({
    maximum: z.number().int().nonnegative().max(100_000),
    names: z.array(PlayerName).max(100_000),
  })
  .strict();
export const QueryResultSchema = PublicPlayersSchema.extend({
  version: z.string().min(1).max(100),
}).superRefine((value, context) => {
  if (
    new Set(value.names).size !== value.names.length ||
    value.names.length > value.maximum
  ) {
    context.addIssue({
      code: "custom",
      message: "Invalid public player roster",
    });
  }
});
export type QueryResult = z.infer<typeof QueryResultSchema>;

function queryReply(bytes: Buffer, type: number, session: Buffer): Buffer {
  if (
    bytes.length > 65_507 ||
    bytes.length < 6 ||
    bytes[0] !== type ||
    !bytes.subarray(1, 5).equals(session)
  ) {
    throw new Error("Invalid Minecraft query envelope");
  }
  return bytes.subarray(5);
}

export function queryHandshake(session: Buffer): Buffer {
  if (session.length !== 4) throw new Error("Invalid Minecraft query session");
  return Buffer.concat([Buffer.from([0xfe, 0xfd, 9]), session]);
}

export function queryFullRequest(bytes: Buffer, session: Buffer): Buffer {
  const payload = queryReply(bytes, 9, session);
  const text = payload.toString("ascii");
  if (!/^-?\d+\0$/.test(text))
    throw new Error("Invalid Minecraft query challenge");
  const challenge = z
    .number()
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .parse(Number(text.slice(0, -1)));
  const token = Buffer.alloc(4);
  token.writeInt32BE(challenge);
  return Buffer.concat([
    Buffer.from([0xfe, 0xfd, 0]),
    session,
    token,
    Buffer.alloc(4),
  ]);
}

export function parseQueryReply(bytes: Buffer, session: Buffer): QueryResult {
  const payload = queryReply(bytes, 0, session);
  if (!payload.subarray(0, QUERY_HEADER.length).equals(QUERY_HEADER))
    throw new Error("Invalid Minecraft full query header");
  const divider = payload.indexOf(PLAYER_MARKER, QUERY_HEADER.length);
  if (divider === -1) throw new Error("Missing Minecraft query roster");
  const fields = payload
    .subarray(QUERY_HEADER.length, divider)
    .toString("utf8")
    .split("\0");
  if (fields.pop() !== "" || fields.length % 2 !== 0)
    throw new Error("Invalid Minecraft query fields");
  const stats: Record<string, string> = {};
  for (let index = 0; index < fields.length; index += 2) {
    const key = fields[index];
    const value = fields[index + 1];
    if (
      key === undefined ||
      key === "" ||
      value === undefined ||
      Object.hasOwn(stats, key)
    )
      throw new Error("Invalid Minecraft query field");
    Object.defineProperty(stats, key, { value, enumerable: true });
  }
  if (stats["plugins"] !== publicQueryContract.queryIdentity)
    throw new Error("Public Minecraft query filter is not ready");
  const roster = payload
    .subarray(divider + PLAYER_MARKER.length)
    .toString("utf8");
  if (!roster.endsWith("\0"))
    throw new Error("Incomplete Minecraft player roster");
  const names = roster.slice(0, -1).split("\0");
  if (names.pop() !== "") throw new Error("Incomplete Minecraft player roster");
  const count = z.string().regex(/^\d+$/).parse(stats["numplayers"]);
  const maximum = z.string().regex(/^\d+$/).parse(stats["maxplayers"]);
  if (Number(count) !== names.length)
    throw new Error("Minecraft player count differs from public roster");
  return QueryResultSchema.parse({
    version: stats["version"],
    maximum: Number(maximum),
    names: names.sort((a, b) => a.localeCompare(b)),
  });
}

export function bedrockPing(timestamp: bigint, guid: Buffer): Buffer {
  if (guid.length !== 8) throw new Error("Invalid Bedrock ping GUID");
  const time = Buffer.alloc(8);
  time.writeBigInt64BE(timestamp);
  return Buffer.concat([Buffer.from([1]), time, MAGIC, guid]);
}

export function parseBedrockPong(
  bytes: Buffer,
  timestamp: bigint,
): { version: string } {
  if (
    bytes.length < 35 ||
    bytes.length > 65_507 ||
    bytes[0] !== 0x1c ||
    bytes.readBigInt64BE(1) !== timestamp ||
    !bytes.subarray(17, 33).equals(MAGIC) ||
    bytes.readUInt16BE(33) !== bytes.length - 35
  ) {
    throw new Error("Invalid Bedrock pong");
  }
  const fields = bytes.subarray(35).toString("utf8").split(";");
  if (fields[0] !== "MCPE") throw new Error("Unexpected Bedrock edition");
  return { version: z.string().min(1).max(100).parse(fields[3]) };
}
