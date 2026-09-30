import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const SnowflakeSchema = z.string().regex(/^\d{17,20}$/u);
const DERREJ_APPLICATION_ID = "1542993271477899294";
const DERREJ_USER_ID = "1515150733660520496";

export const DiscordSmokeFixtureSchema = z.object({
  applicationId: z.literal(DERREJ_APPLICATION_ID),
  botUserId: z.literal(DERREJ_APPLICATION_ID),
  invokingUserId: z.literal(DERREJ_USER_ID),
  recipientUserId: SnowflakeSchema,
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  pinchTabProfile: z.literal("scout-discord-smoke"),
});
export type DiscordSmokeFixture = z.infer<typeof DiscordSmokeFixtureSchema>;

export const DiscordSmokeManifestSchema = z.object({
  runId: z.string().min(1),
  scenario: z.string().min(1),
  createdAt: z.iso.datetime(),
  databaseName: z
    .string()
    .regex(/^scout_test_[a-z0-9_]+$/u)
    .nullable(),
  databaseUrl: z.url().nullable(),
  seededAccounts: z
    .object({
      senderId: z.number().int().positive(),
      senderBalance: z.number().int(),
      recipientId: z.number().int().positive(),
      recipientBalance: z.number().int(),
      houseId: z.number().int().positive(),
      houseBalance: z.number().int(),
    })
    .nullable(),
  invocationStartedAt: z.iso.datetime().nullable(),
  privateReplyId: SnowflakeSchema.nullable(),
  publicMessageId: SnowflakeSchema.nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  screenshotPath: z.string().nullable(),
});
export type DiscordSmokeManifest = z.infer<typeof DiscordSmokeManifestSchema>;

const DiscordIdentitySchema = z.object({ id: SnowflakeSchema });
const DiscordGuildSchema = z.object({ id: SnowflakeSchema });
const DiscordChannelSchema = z.object({
  id: SnowflakeSchema,
  guild_id: SnowflakeSchema,
});
const DiscordApplicationSchema = z.object({ id: SnowflakeSchema });
const DiscordGuildMemberSchema = z.object({
  user: z.object({ id: SnowflakeSchema }),
});
const DiscordCommandSchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  options: z
    .array(
      z.object({
        type: z.number().int(),
        name: z.string(),
      }),
    )
    .optional(),
});

export type DiscordSmokePreflightDependencies = {
  readonly fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly verifyPinchTabProfile: (
    profileName: string,
    guildId: string,
    channelId: string,
  ) => Promise<void>;
};

export type DiscordSmokeRuntime = {
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
};

type RuntimeReadinessDependencies = {
  readonly fileExists: (filePath: string) => Promise<boolean>;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
};

const runtimeReadinessDependencies: RuntimeReadinessDependencies = {
  fileExists: async (filePath) => await Bun.file(filePath).exists(),
  now: Date.now,
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

export async function raceRuntimeOperation<Value>(
  runtime: DiscordSmokeRuntime,
  operation: Promise<Value>,
  description: string,
): Promise<Value> {
  const outcome = await Promise.race([
    operation.then((value) => ({ kind: "completed", value }) as const),
    runtime.exited.then((exitCode) => ({ kind: "exited", exitCode }) as const),
  ]);
  if (outcome.kind === "exited") {
    throw new Error(
      `Scout Discord runtime exited with code ${outcome.exitCode.toString()} ${description}`,
    );
  }
  if (runtime.exitCode !== null) {
    throw new Error(
      `Scout Discord runtime exited with code ${runtime.exitCode.toString()} ${description}`,
    );
  }
  return outcome.value;
}

export async function waitForRuntimeReadiness(
  runtime: DiscordSmokeRuntime,
  readyPath: string,
  timeoutMilliseconds = 60_000,
  dependencies: RuntimeReadinessDependencies = runtimeReadinessDependencies,
): Promise<void> {
  const deadline = dependencies.now() + timeoutMilliseconds;
  const waitForFile = async (): Promise<void> => {
    while (dependencies.now() < deadline) {
      if (await dependencies.fileExists(readyPath)) {
        return;
      }
      await dependencies.sleep(100);
    }
    throw new Error(
      `Scout Discord runtime did not write readiness file ${readyPath} before timeout`,
    );
  };
  await raceRuntimeOperation(
    runtime,
    waitForFile(),
    "before reporting gateway readiness",
  );
}

async function discordJson(
  fetcher: DiscordSmokePreflightDependencies["fetch"],
  pathname: string,
  authorization: string,
): Promise<unknown> {
  const response = await fetcher(`https://discord.com/api/v10${pathname}`, {
    headers: { authorization },
  });
  if (!response.ok) {
    throw new Error(
      `Discord preflight ${pathname} returned HTTP ${response.status.toString()}`,
    );
  }
  return response.json();
}

async function verifyIdentityAccess(
  dependencies: DiscordSmokePreflightDependencies,
  authorization: string,
  expectedUserId: string,
  fixture: DiscordSmokeFixture,
): Promise<void> {
  const identity = DiscordIdentitySchema.parse(
    await discordJson(dependencies.fetch, "/users/@me", authorization),
  );
  if (identity.id !== expectedUserId) {
    throw new Error(
      `Discord credential resolved user ${identity.id}, expected ${expectedUserId}`,
    );
  }
  const guilds = z
    .array(DiscordGuildSchema)
    .parse(
      await discordJson(dependencies.fetch, "/users/@me/guilds", authorization),
    );
  if (!guilds.some((guild) => guild.id === fixture.guildId)) {
    throw new Error(
      `Discord user ${expectedUserId} is not in smoke guild ${fixture.guildId}`,
    );
  }
  const channel = DiscordChannelSchema.parse(
    await discordJson(
      dependencies.fetch,
      `/channels/${fixture.channelId}`,
      authorization,
    ),
  );
  if (channel.guild_id !== fixture.guildId) {
    throw new Error(
      `Smoke channel ${fixture.channelId} is not in guild ${fixture.guildId}`,
    );
  }
}

export async function preflightDiscordSmoke(
  fixture: DiscordSmokeFixture,
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: DiscordSmokePreflightDependencies,
): Promise<void> {
  const botToken = environment["DISCORD_BOT_TOKEN"];
  const userToken = environment["DISCORD_USER_TOKEN"];
  if (botToken === undefined || botToken.length === 0) {
    throw new Error("Discord smoke requires DISCORD_BOT_TOKEN");
  }
  if (userToken === undefined || userToken.length === 0) {
    throw new Error("Discord smoke requires DISCORD_USER_TOKEN");
  }

  const botAuthorization = `Bot ${botToken}`;
  await verifyIdentityAccess(
    dependencies,
    botAuthorization,
    fixture.botUserId,
    fixture,
  );
  await verifyIdentityAccess(
    dependencies,
    userToken,
    fixture.invokingUserId,
    fixture,
  );
  const application = DiscordApplicationSchema.parse(
    await discordJson(
      dependencies.fetch,
      "/oauth2/applications/@me",
      botAuthorization,
    ),
  );
  if (application.id !== fixture.applicationId) {
    throw new Error(
      `Discord bot token belongs to application ${application.id}, expected ${fixture.applicationId}`,
    );
  }
  const recipientMember = DiscordGuildMemberSchema.parse(
    await discordJson(
      dependencies.fetch,
      `/guilds/${fixture.guildId}/members/${fixture.recipientUserId}`,
      botAuthorization,
    ),
  );
  if (recipientMember.user.id !== fixture.recipientUserId) {
    throw new Error(
      `Discord smoke recipient resolved user ${recipientMember.user.id}, expected ${fixture.recipientUserId}`,
    );
  }
  await dependencies.verifyPinchTabProfile(
    fixture.pinchTabProfile,
    fixture.guildId,
    fixture.channelId,
  );
}

export function assertInvocationAllowed(manifest: DiscordSmokeManifest): void {
  if (
    manifest.invocationStartedAt !== null ||
    manifest.privateReplyId !== null ||
    manifest.publicMessageId !== null
  ) {
    throw new Error(
      `Smoke run ${manifest.runId} may not invoke again; use --resume ${manifest.runId}`,
    );
  }
}

export async function waitForDiscordCommand(
  params: {
    readonly fixture: DiscordSmokeFixture;
    readonly botToken: string;
    readonly commandName: string;
    readonly subcommandName?: string | undefined;
    readonly guildScoped: boolean;
    readonly timeoutMilliseconds?: number | undefined;
  },
  fetcher: DiscordSmokePreflightDependencies["fetch"] = fetch,
): Promise<void> {
  const pathname = params.guildScoped
    ? `/applications/${params.fixture.applicationId}/guilds/${params.fixture.guildId}/commands`
    : `/applications/${params.fixture.applicationId}/commands`;
  const timeoutMilliseconds = params.timeoutMilliseconds ?? 45_000;
  const deadline = Date.now() + timeoutMilliseconds;
  let lastNames: string[] = [];
  while (Date.now() < deadline) {
    const commands = z
      .array(DiscordCommandSchema)
      .parse(await discordJson(fetcher, pathname, `Bot ${params.botToken}`));
    lastNames = commands.map((command) => command.name);
    if (
      commands.some(
        (command) =>
          command.name === params.commandName &&
          (params.subcommandName === undefined ||
            command.options?.some(
              (option) =>
                option.type === 1 && option.name === params.subcommandName,
            ) === true),
      )
    ) {
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `Discord did not expose /${params.commandName}${params.subcommandName === undefined ? "" : ` ${params.subcommandName}`} before timeout; observed [${lastNames.join(", ")}]`,
  );
}

export async function loadDiscordSmokeFixture(
  fixturePath: string,
): Promise<DiscordSmokeFixture> {
  const parsed: unknown = JSON.parse(await Bun.file(fixturePath).text());
  return DiscordSmokeFixtureSchema.parse(parsed);
}

export async function loadDiscordSmokeManifest(
  manifestPath: string,
): Promise<DiscordSmokeManifest> {
  const parsed: unknown = JSON.parse(await Bun.file(manifestPath).text());
  return DiscordSmokeManifestSchema.parse(parsed);
}

export async function writeDiscordSmokeManifest(
  manifestPath: string,
  manifest: DiscordSmokeManifest,
): Promise<void> {
  const validated = DiscordSmokeManifestSchema.parse(manifest);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`);
  await rename(temporaryPath, manifestPath);
}
