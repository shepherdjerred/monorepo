import type {
  Session,
  CreateSessionRequest,
  RecentRepoDto,
  AccessMode,
  SystemStatus,
  UpdateCredentialRequest,
  AuthStatus,
  RegistrationStartRequest,
  RegistrationStartResponse,
  RegistrationFinishRequest,
  RegistrationFinishResponse,
  LoginStartRequest,
  LoginStartResponse,
  LoginFinishRequest,
  LoginFinishResponse,
  BrowseDirectoryRequest,
  BrowseDirectoryResponse,
  UploadResponse,
  UserPreferences,
} from "@clauderon/shared";
import { ApiError, NetworkError, SessionNotFoundError } from "./errors.js";

/**
 * Configuration options for ClauderonClient
 */
export type ClauderonClientConfig = {
  /**
   * Base URL for the Clauderon HTTP API
   * @default "http://localhost:3030"
   */
  baseUrl?: string;

  /**
   * Custom fetch implementation (useful for testing)
   */
  fetch?: typeof fetch;
}

/**
 * Get the default base URL based on the current environment.
 * In browser context, derives from window.location.
 * In non-browser context, defaults to localhost:3030.
 */
function getDefaultBaseUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return "http://localhost:3030";
}

/**
 * Type-safe HTTP client for the Clauderon API
 */
export class ClauderonClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(config: ClauderonClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? getDefaultBaseUrl();
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<Session[]> {
    const response = await this.request<{ sessions: Session[] }>("GET", "/api/sessions");
    return response.sessions;
  }

  /**
   * Get a specific session by ID or name
   */
  async getSession(id: string): Promise<Session> {
    try {
      const response = await this.request<{ session: Session }>("GET", `/api/sessions/${encodeURIComponent(id)}`);
      return response.session;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        throw new SessionNotFoundError(id);
      }
      throw error;
    }
  }

  /**
   * Create a new session
   */
  async createSession(request: CreateSessionRequest): Promise<{ id: string; warnings?: string[] }> {
    const response = await this.request<{ id: string; warnings?: string[] }>(
      "POST",
      "/api/sessions",
      request
    );
    return response;
  }

  /**
   * Delete a session
   */
  async deleteSession(id: string): Promise<void> {
    await this.request("DELETE", `/api/sessions/${encodeURIComponent(id)}`);
  }

  /**
   * Archive a session
   */
  async archiveSession(id: string): Promise<void> {
    await this.request("POST", `/api/sessions/${encodeURIComponent(id)}/archive`);
  }

  /**
   * Unarchive a session
   */
  async unarchiveSession(id: string): Promise<void> {
    await this.request("POST", `/api/sessions/${encodeURIComponent(id)}/unarchive`);
  }

  /**
   * Refresh a session (pull latest image and recreate container)
   */
  async refreshSession(id: string): Promise<void> {
    await this.request("POST", `/api/sessions/${encodeURIComponent(id)}/refresh`);
  }

  /**
   * Get recent repositories
   */
  async getRecentRepos(): Promise<RecentRepoDto[]> {
    const response = await this.request<{ repos: RecentRepoDto[] }>("GET", "/api/recent-repos");
    return response.repos;
  }

  /**
   * Browse a directory on the daemon's filesystem
   * @param path Path to the directory to browse
   */
  async browseDirectory(path: string): Promise<BrowseDirectoryResponse> {
    const request: BrowseDirectoryRequest = { path };
    const response = await this.request<BrowseDirectoryResponse>("POST", "/api/browse-directory", request);
    return response;
  }

  /**
   * Update session access mode
   */
  async updateAccessMode(id: string, mode: AccessMode): Promise<void> {
    await this.request("POST", `/api/sessions/${encodeURIComponent(id)}/access-mode`, { access_mode: mode });
  }

  /**
   * Update session metadata (title and/or description)
   */
  async updateSessionMetadata(
    id: string,
    title?: string,
    description?: string
  ): Promise<void> {
    await this.request("POST", `/api/sessions/${encodeURIComponent(id)}/metadata`, {
      title,
      description,
    });
  }

  /**
   * Regenerate session metadata using AI
   * Returns the updated session with new title and description
   */
  async regenerateMetadata(id: string): Promise<Session> {
    const response = await this.request<{ session: Session }>("POST", `/api/sessions/${encodeURIComponent(id)}/regenerate-metadata`);
    return response.session;
  }

  /**
   * Get system status including credentials and proxies
   */
  async getSystemStatus(): Promise<SystemStatus> {
    const response = await this.request<SystemStatus>("GET", "/api/status");
    return response;
  }

  /**
   * Update a credential value
   */
  async updateCredential(serviceId: string, value: string): Promise<void> {
    const request: UpdateCredentialRequest = {
      service_id: serviceId,
      value,
    };
    await this.request("POST", "/api/credentials", request);
  }

  /**
   * Get session history from Claude Code's JSONL file
   *
   * @param id Session ID
   * @param sinceLine Optional line number to start from (for incremental updates)
   * @param limit Optional max number of lines to return
   */
  async getSessionHistory(
    id: string,
    sinceLine?: number,
    limit?: number
  ): Promise<{ lines: string[]; totalLines: number; fileExists: boolean }> {
    const params = new URLSearchParams();
    if (sinceLine !== undefined) {
      params.append("since_line", sinceLine.toString());
    }
    if (limit !== undefined) {
      params.append("limit", limit.toString());
    }

    const queryString = params.toString();
    const url = `/api/sessions/${encodeURIComponent(id)}/history${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<{
      lines: string[];
      total_lines: number;
      file_exists: boolean;
    }>("GET", url);

    return {
      lines: response.lines,
      totalLines: response.total_lines,
      fileExists: response.file_exists,
    };
  }

  // Authentication methods

  /**
   * Get authentication status
   */
  async getAuthStatus(): Promise<AuthStatus> {
    const response = await this.request<AuthStatus>("GET", "/api/auth/status");
    return response;
  }

  /**
   * Start passkey registration
   */
  async registerStart(request: RegistrationStartRequest): Promise<RegistrationStartResponse> {
    const response = await this.request<RegistrationStartResponse>("POST", "/api/auth/register/start", request);
    return response;
  }

  /**
   * Finish passkey registration
   */
  async registerFinish(request: RegistrationFinishRequest): Promise<RegistrationFinishResponse> {
    const response = await this.request<RegistrationFinishResponse>("POST", "/api/auth/register/finish", request);
    return response;
  }

  /**
   * Start passkey login
   */
  async loginStart(request: LoginStartRequest): Promise<LoginStartResponse> {
    const response = await this.request<LoginStartResponse>("POST", "/api/auth/login/start", request);
    return response;
  }

  /**
   * Finish passkey login
   */
  async loginFinish(request: LoginFinishRequest): Promise<LoginFinishResponse> {
    const response = await this.request<LoginFinishResponse>("POST", "/api/auth/login/finish", request);
    return response;
  }

  /**
   * Logout (delete current session)
   */
  async logout(): Promise<void> {
    await this.request("POST", "/api/auth/logout");
  }

  /**
   * Upload an image file for a session
   * @param sessionId Session ID
   * @param file Image file to upload
   */
  async uploadImage(sessionId: string, file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/upload`;

    try {
      const response = await this.fetch(url, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        // Don't set Content-Type header - browser will set it with boundary for multipart
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new ApiError(
          data.error ?? `HTTP ${String(response.status)}: ${response.statusText}`,
          undefined,
          response.status
        );
      }

      return await response.json() as UploadResponse;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new NetworkError(
        `Failed to upload image: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(): Promise<UserPreferences> {
    return await this.request<UserPreferences>("GET", "/api/preferences");
  }

  /**
   * Track a user operation (session_created, session_attached, advanced_operation)
   */
  async trackOperation(operation: "session_created" | "session_attached" | "advanced_operation"): Promise<void> {
    await this.request("POST", "/api/preferences/track", { operation });
  }

  /**
   * Dismiss a hint by ID
   */
  async dismissHint(hintId: string): Promise<void> {
    await this.request("POST", "/api/preferences/dismiss-hint", { hint_id: hintId });
  }

  /**
   * Mark first run experience as complete
   */
  async completeFirstRun(): Promise<void> {
    await this.request("POST", "/api/preferences/complete-first-run");
  }

  /**
   * Internal method to make HTTP requests
   */
  private async request<T = void>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const init: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }

      const response = await this.fetch(url, init);

      // Handle empty responses (204 No Content, etc.)
      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return undefined as T;
      }

      // Parse JSON response
      const data: unknown = await response.json();

      // Check for error responses
      if (!response.ok) {
        const errorData = data as { error?: string };
        throw new ApiError(
          errorData.error ?? `HTTP ${String(response.status)}: ${response.statusText}`,
          undefined,
          response.status
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new NetworkError(
        `Failed to fetch ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }
}
