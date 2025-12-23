import * as log from 'loglevel';
import Config from './Config';

const envVarPrefix = 'EASEL_';

export default class HerokuConfig implements Config {
  dbUrl = HerokuConfig.getEnvironmentVariable('CLEARDB_DATABASE_URL');
  expressPort = HerokuConfig.getEnvironmentVariable('PORT');
  jwtSecret = HerokuConfig.getPrefixedEnvironmentVariable('JWT_SECRET');
  jwtIssuer = HerokuConfig.getPrefixedEnvironmentVariable('JWT_ISSUER');
  isRegistrationEnabled = HerokuConfig.getPrefixedEnvironmentVariable('IS_REGISTRATION_ENABLED');
  isAuthenticationEnabled = HerokuConfig.getPrefixedEnvironmentVariable('IS_AUTHENTICATION_ENABLED');
  isAuthorizationEnabled = HerokuConfig.getPrefixedEnvironmentVariable('IS_AUTHORIZATION_ENABLED');
  isDevelopmentMode = HerokuConfig.getPrefixedEnvironmentVariable('IS_DEVELOPMENT_MODE');
  shouldForceModelSync = HerokuConfig.getPrefixedEnvironmentVariable('SHOULD_FORCE_MODEL_SYNC');
  frontEndUrl = HerokuConfig.getPrefixedEnvironmentVariable('FRONT_END_URL');

  static getEnvironmentVariable (name: string): any {
    if (process.env.hasOwnProperty(name)) {
      return process.env[name];
    } else {
      log.error('Environment variable %s has not been set', name);
      return undefined;
    }
  }

  static getPrefixedEnvironmentVariable (name: string): any {
    return this.getEnvironmentVariable(envVarPrefix + name);
  }
}
