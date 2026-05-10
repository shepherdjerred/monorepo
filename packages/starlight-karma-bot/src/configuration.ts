import dotenv from "dotenv";
import env from "env-var";

dotenv.config();

export default {
  version: env.get("VERSION").required().asString(),
  environment: env
    .get("ENVIRONMENT")
    .default("dev")
    .asEnum(["dev", "beta", "prod"]),
  gitSha: env.get("GIT_SHA").required().asString(),
  sentryDsn: env.get("SENTRY_DSN").asString(),
  port: env.get("PORT").default("8000").asPortNumber(),
  discordToken: env.get("DISCORD_TOKEN").required().asString(),
  applicationId: env.get("APPLICATION_ID").required().asString(),
  dataDir: env.get("DATA_DIR").required().asString(),
};
