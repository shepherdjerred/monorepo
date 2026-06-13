export interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  avatar_url: string;
  name: string | null;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface JWTPayload {
  userId: string;
  githubId: string;
  username: string;
  [key: string]: unknown;
}

export interface AuthContext {
  userId: string;
  githubId: string;
  username: string;
}
