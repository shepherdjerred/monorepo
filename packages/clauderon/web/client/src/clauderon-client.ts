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
  BrowseDirectoryResponse,
  UploadResponse,
  HealthCheckResult,
  SessionHealthReport,
  RecreateResult,
  FeatureFlagsResponse,
  MergeMethod,
  MergePrRequest,
} from "@clauderon/shared";
import { ApiError, NetworkError, SessionNotFoundError } from "./errors.ts";
import {
  type ClauderonClientConfig,
  type StorageClassInfo,
  getDefaultBaseUrl,
} from "./client-types.ts";
import { readResponseJson } from "./json.ts";

function extractErrorMessage(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const error: unknown = Reflect.get(data, "error");
  return typeof error === "string" ? error : undefined;
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
    const response = await this.request<{ sessions: Session[] }>(
      "GET",
      "/api/sessions",
    );
    return response.sessions;
  }

  /**
   * Get a specific session by ID or name
   */
  async getSession(id: string): Promise<Session> {
    try {
      const response = await this.request<{ session: Session }>(
        "GET",
        `/api/sessions/${encodeURIComponent(id)}`,
      );
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
  async createSession(
    request: CreateSessionRequest,
  ): Promise<{ id: string; warnings?: string[] }> {
    return this.request<{ id: string; warnings?: string[] }>(
      "POST",
      "/api/sessions",
      request,
    );
  }

  async deleteSession(id: string): Promise<void> {
    await this.requestVoid("DELETE", `/api/sessions/${encodeURIComponent(id)}`);
  }

  async archiveSession(id: string): Promise<void> {
    await this.requestVoid(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/archive`,
    );
  }

  async unarchiveSession(id: string): Promise<void> {
    await this.requestVoid(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/unarchive`,
    );
  }

  async refreshSession(id: string): Promise<void> {
    await this.requestVoid(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/refresh`,
    );
  }

  async getHealth(): Promise<HealthCheckResult> {
    return this.request<HealthCheckResult>("GET", "/api/health");
  }

  async getSessionHealth(id: string): Promise<SessionHealthReport> {
    return this.request<SessionHealthReport>("GET", `/api/sessions/${encodeURIComponent(id)}/health`);
  }

  /**
   * Start a stopped session (container/pod)
   */
  async startSession(id: string): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/start`);
  }

  /**
   * Wake a hibernated session (sprites)
   */
  async wakeSession(id: string): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/wake`);
  }

  async recreateSession(id: string): Promise<RecreateResult> {
    return this.request<RecreateResult>("POST", `/api/sessions/${encodeURIComponent(id)}/recreate`);
  }

  async cleanupSession(id: string): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/cleanup`);
  }

  async getRecentRepos(): Promise<RecentRepoDto[]> {
    const response = await this.request<{ repos: RecentRepoDto[] }>("GET", "/api/recent-repos");
    return response.repos;
  }

  async browseDirectory(path: string): Promise<BrowseDirectoryResponse> {
    return this.request<BrowseDirectoryResponse>("POST", "/api/browse-directory", { path });
  }

  async updateAccessMode(id: string, mode: AccessMode): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/access-mode`, { access_mode: mode });
  }

  async updateSessionMetadata(id: string, title?: string, description?: string): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/metadata`, { title, description });
  }

  async regenerateMetadata(id: string): Promise<Session> {
    const response = await this.request<{ session: Session }>(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/regenerate-metadata`,
    );
    return response.session;
  }

  async mergePr(id: string, method: MergeMethod, deleteBranch: boolean): Promise<void> {
    const request: MergePrRequest = { method, delete_branch: deleteBranch };
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/merge-pr`, request);
  }

  async getSystemStatus(): Promise<SystemStatus> {
    return this.request<SystemStatus>("GET", "/api/status");
  }

  async getFeatureFlags(): Promise<FeatureFlagsResponse> {
    return this.request<FeatureFlagsResponse>("GET", "/api/feature-flags");
  }

  async updateCredential(serviceId: string, value: string): Promise<void> {
    const request: UpdateCredentialRequest = { service_id: serviceId, value };
    await this.requestVoid("POST", "/api/credentials", request);
  }

  /**
   * Get available Kubernetes storage classes
   * Only applicable when Kubernetes backend is available
   */
  async getStorageClasses(): Promise<StorageClassInfo[]> {
    try {
      const response = await this.request<{
        storage_classes: StorageClassInfo[];
      }>("GET", "/api/storage-classes");
      return response.storage_classes;
    } catch (error) {
      // If endpoint not available or K8s not configured, return empty array
      if (
        error instanceof ApiError &&
        (error.statusCode === 404 || error.statusCode === 501)
      ) {
        return [];
      }
      throw error;
    }
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
    limit?: number,
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

  async getAuthStatus(): Promise<AuthStatus> {
    return this.request<AuthStatus>("GET", "/api/auth/status");
  }

  async registerStart(
    request: RegistrationStartRequest,
  ): Promise<RegistrationStartResponse> {
    return this.request<RegistrationStartResponse>(
      "POST",
      "/api/auth/register/start",
      request,
    );
  }

  async registerFinish(
    request: RegistrationFinishRequest,
  ): Promise<RegistrationFinishResponse> {
    return this.request<RegistrationFinishResponse>(
      "POST",
      "/api/auth/register/finish",
      request,
    );
  }

  async loginStart(request: LoginStartRequest): Promise<LoginStartResponse> {
    return this.request<LoginStartResponse>(
      "POST",
      "/api/auth/login/start",
      request,
    );
  }

  async loginFinish(request: LoginFinishRequest): Promise<LoginFinishResponse> {
    return this.request<LoginFinishResponse>(
      "POST",
      "/api/auth/login/finish",
      request,
    );
  }

  async logout(): Promise<void> {
    await this.requestVoid("POST", "/api/auth/logout");
  }

  /**
   * Upload an image file for a session
   * @param sessionId Session ID
   * @param file Image file to upload
   */
  async uploadImage(sessionId: string, file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("file", file);

    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/upload`;

    try {
      const response = await this.fetch(url, {
        method: "POST",
        body: formData,
        credentials: "include",
        // Don't set Content-Type header - browser will set it with boundary for multipart
      });

      if (!response.ok) {
        const data = await readResponseJson(response);
        throw new ApiError(
          extractErrorMessage(data) ??
            `HTTP ${String(response.status)}: ${response.statusText}`,
          undefined,
          response.status,
        );
      }

      return await readResponseJson<UploadResponse>(response);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new NetworkError(
        `Failed to upload image: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Internal: make an HTTP request expecting a JSON response body
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.doFetch(method, path, body);
    return await readResponseJson<T>(response);
  }

  /**
   * Internal: make an HTTP request expecting no response body
   */
  private async requestVoid(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<void> {
    await this.doFetch(method, path, body);
  }

  /**
   * Shared fetch logic: builds request, handles errors, returns the raw Response
   */
  private async doFetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
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

      // Check for error responses
      if (!response.ok) {
        const data = await readResponseJson(response);
        throw new ApiError(
          extractErrorMessage(data) ??
            `HTTP ${String(response.status)}: ${response.statusText}`,
          undefined,
          response.status,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new NetworkError(
        `Failed to fetch ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
}
