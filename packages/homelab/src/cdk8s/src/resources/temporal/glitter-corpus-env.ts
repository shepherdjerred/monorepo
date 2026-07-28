import { EnvValue, type ISecret } from "cdk8s-plus-31";

export function glitterCorpusEnv(
  workerSecret: ISecret,
  starlightBotSecret: ISecret,
): Record<string, EnvValue> {
  return {
    GLITTER_DISCORD_TOKEN: EnvValue.fromSecretValue({
      secret: starlightBotSecret,
      key: "DISCORD_TOKEN",
    }),
    GLITTER_DISCORD_GUILD_ID: EnvValue.fromValue("208425771172102144"),
    GLITTER_DISCORD_GUILD_SLUG: EnvValue.fromValue("glitter-boys"),
    // Inventory approval is the scope authority. Keep exclusions explicit so
    // the runtime fails if this value is ever accidentally removed.
    GLITTER_DISCORD_DENYLIST_CHANNEL_IDS: EnvValue.fromValue(""),
    GLITTER_CORPUS_S3_ENDPOINT: EnvValue.fromSecretValue({
      secret: workerSecret,
      key: "S3_ENDPOINT",
    }),
    GLITTER_CORPUS_S3_BUCKET: EnvValue.fromValue("glitter-discord-corpus"),
    GLITTER_CORPUS_S3_ACCESS_KEY_ID: EnvValue.fromSecretValue({
      secret: workerSecret,
      key: "AWS_ACCESS_KEY_ID",
    }),
    GLITTER_CORPUS_S3_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
      secret: workerSecret,
      key: "AWS_SECRET_ACCESS_KEY",
    }),
    GLITTER_CORPUS_S3_REGION: EnvValue.fromValue("us-east-1"),
  };
}
