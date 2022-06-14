import auth0, { Auth0DecodedHash, Auth0ParseHashError } from "auth0-js";

export const domain = "mira-hq.us.auth0.com";
export const clientId = "1OSHUpbrfygF5A9JpcywmascOW7ilnIl";

class Auth {
  auth0: auth0.WebAuth;
  idToken?: string;
  expiresAt?: Date;

  constructor() {
    this.auth0 = new auth0.WebAuth({
      domain: domain,
      clientID: clientId,
      redirectUri: "http://localhost:3000/callback",
      audience: `https://${domain}/userinfo`,
      responseType: "token id_token",
      scope: "openid email",
    });

    this.login = this.login.bind(this);
    this.logout = this.logout.bind(this);
    this.handleAuthentication = this.handleAuthentication.bind(this);
    this.isAuthenticated = this.isAuthenticated.bind(this);
  }

  login() {
    this.auth0.authorize();
  }

  getIdToken() {
    return this.idToken;
  }

  handleAuthentication(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.auth0.parseHash(
        (
          err: Auth0ParseHashError | null,
          authResult: Auth0DecodedHash | null
        ) => {
          if (err) return reject(err);
          if (!authResult || !authResult.idToken) {
            return reject(err);
          }
          this.setSession(authResult);
          resolve();
        }
      );
    });
  }

  setSession(authResult: Auth0DecodedHash) {
    this.idToken = authResult.idToken;
    console.log(this.idToken);
    // set the time that the id token will expire at
    const now = new Date();
    this.expiresAt = new Date(now.setDate(now.getTime() + 1000));
  }

  logout() {
    this.auth0.logout({
      returnTo: "http://localhost:3000",
      clientID: clientId,
    });
  }

  silentAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.auth0.checkSession({}, (err, authResult) => {
        if (err) return reject(err);
        this.setSession(authResult);
        resolve();
      });
    });
  }

  isAuthenticated() {
    // Check whether the current time is past the token's expiry time
    return new Date().getTime() < (this.expiresAt?.getTime() || Date.now());
  }
}

const auth = new Auth();

export default auth;
