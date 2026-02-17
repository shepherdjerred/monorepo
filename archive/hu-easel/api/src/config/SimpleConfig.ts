import Config from "./Config";

export default class SimpleConfig implements Config {
  isAuthenticationEnabled: boolean;
  isAuthorizationEnabled: boolean;
  dbHost: string;
  dbName: string;
  dbPassword: string;
  dbPort: number;
  dbUsername: string;
  expressPort: number;
  jwtIssuer: string;
  jwtSecret: string;
  isRegistrationEnabled: boolean;
  isDevelopmentMode: boolean;
  shouldForceModelSync: boolean;
  frontEndUrl: string;

  constructor(
    isAuthenticationEnabled: boolean,
    isAuthorizationEnabled: boolean,
    dbHost: string,
    dbName: string,
    dbPassword: string,
    dbPort: number,
    dbUsername: string,
    expressPort: number,
    jwtIssuer: string,
    jwtSecret: string,
    isRegistrationEnabled: boolean,
    isDevelopmentMode: boolean,
    shouldForceModelSync: boolean,
    frontEndUrl: string,
  ) {
    this.isAuthenticationEnabled = isAuthenticationEnabled;
    this.isAuthorizationEnabled = isAuthorizationEnabled;
    this.dbHost = dbHost;
    this.dbName = dbName;
    this.dbPassword = dbPassword;
    this.dbPort = dbPort;
    this.dbUsername = dbUsername;
    this.expressPort = expressPort;
    this.jwtIssuer = jwtIssuer;
    this.jwtSecret = jwtSecret;
    this.isRegistrationEnabled = isRegistrationEnabled;
    this.isDevelopmentMode = isDevelopmentMode;
    this.shouldForceModelSync = shouldForceModelSync;
    this.frontEndUrl = frontEndUrl;
  }
}
