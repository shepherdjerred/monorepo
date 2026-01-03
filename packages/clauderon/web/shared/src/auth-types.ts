// Authentication types
// These will be replaced by typeshare-generated types once Rust builds

export interface AuthUser {
  id: string;
  username: string;
  display_name: string | null;
  created_at: string;
}

export interface Passkey {
  id: string;
  user_id: string;
  device_name: string | null;
  created_at: string;
}

export interface AuthStatus {
  requires_auth: boolean;
  has_users: boolean;
  current_user: AuthUser | null;
}

export interface RegistrationStartRequest {
  username: string;
  display_name: string | null;
}

export interface RegistrationStartResponse {
  options: any; // PublicKeyCredentialCreationOptions
}

export interface RegistrationFinishRequest {
  username: string;
  credential: any; // PublicKeyCredential
  device_name: string | null;
}

export interface RegistrationFinishResponse {
  user: AuthUser;
}

export interface LoginStartRequest {
  username: string;
}

export interface LoginStartResponse {
  options: any; // PublicKeyCredentialRequestOptions
}

export interface LoginFinishRequest {
  username: string;
  credential: any; // PublicKeyCredential
}

export interface LoginFinishResponse {
  user: AuthUser;
}
