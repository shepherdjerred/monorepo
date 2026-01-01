import type {
  Session,
  CreateSessionRequest,
  RecentRepoDto,
  AccessMode,
  SystemStatus,
  UpdateCredentialRequest,
} from "@mux/shared";
import { ApiError, NetworkError, SessionNotFoundError } from "./errors.js";

/**
 * Configuration options for MuxClient
 */
export type MuxClientConfig = {
  /**
   * Base URL for the Mux HTTP API
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
 * Type-safe HTTP client for the Mux API
 */
export class MuxClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(config: MuxClientConfig = {}) {
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
   * Get recent repositories
   */
  async getRecentRepos(): Promise<RecentRepoDto[]> {
    const response = await this.request<{ repos: RecentRepoDto[] }>("GET", "/api/recent-repos");
    return response.repos;
  }

  /**
   * Update session access mode
   */
  async updateAccessMode(id: string, mode: AccessMode): Promise<void> {
    await this.request("POST", `/api/sessions/${encodeURIComponent(id)}/access-mode`, { mode });
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
