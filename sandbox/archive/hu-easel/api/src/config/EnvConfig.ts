import * as log from "loglevel";
import Config from "./Config";

const envVarPrefix = "EASEL_";

export default class EnvConfig implements Config {
  dbHost = EnvConfig.getEnvironmentVariable("DB_HOST");
  dbPort = EnvConfig.getEnvironmentVariable("DB_PORT");
  dbName = EnvConfig.getEnvironmentVariable("DB_NAME");
  dbUsername = EnvConfig.getEnvironmentVariable("DB_USERNAME");
  dbPassword = EnvConfig.getEnvironmentVariable("DB_PASSWORD");
  expressPort = EnvConfig.getEnvironmentVariable("EXPRESS_PORT");
  jwtSecret = EnvConfig.getEnvironmentVariable("JWT_SECRET");
  jwtIssuer = EnvConfig.getEnvironmentVariable("JWT_ISSUER");
  isRegistrationEnabled = EnvConfig.getEnvironmentVariable(
    "IS_REGISTRATION_ENABLED",
  );
  isAuthenticationEnabled = EnvConfig.getEnvironmentVariable(
    "IS_AUTHENTICATION_ENABLED",
  );
  isAuthorizationEnabled = EnvConfig.getEnvironmentVariable(
    "IS_AUTHORIZATION_ENABLED",
  );
  isDevelopmentMode = EnvConfig.getEnvironmentVariable("IS_DEVELOPMENT_MODE");
  shouldForceModelSync = EnvConfig.getEnvironmentVariable(
    "SHOULD_FORCE_MODEL_SYNC",
  );
  frontEndUrl = EnvConfig.getEnvironmentVariable("FRONT_END_URL");

  static getEnvironmentVariable(name: string): any {
    name = envVarPrefix + name;
    if (process.env.hasOwnProperty(name)) {
      return process.env[name];
    } else {
      log.error("Environment variable %s has not been set", name);
      return undefined;
    }
  }
}
