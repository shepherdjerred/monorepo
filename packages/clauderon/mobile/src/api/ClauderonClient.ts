import type {
  Session,
  CreateSessionRequest,
  RecentRepoDto,
  AccessMode,
  SystemStatus,
  UpdateCredentialRequest,
  UploadResponse,
} from "../types/generated";
import { ApiError, NetworkError, SessionNotFoundError } from "./errors";
import { Platform } from "react-native";

/**
 * Configuration options for ClauderonClient
 */
export type ClauderonClientConfig = {
  /**
   * Base URL for the Clauderon HTTP API (required for mobile)
   */
  baseUrl: string;

  /**
   * Custom fetch implementation (useful for testing)
   */
  fetch?: typeof fetch;
};

/**
 * Type-safe HTTP client for the Clauderon API
 */
export class ClauderonClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(config: ClauderonClientConfig) {
    this.baseUrl = config.baseUrl;
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<Session[]> {
    const response = await this.request<{ sessions: Session[] }>(
      "GET",
      "/api/sessions"
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
        `/api/sessions/${encodeURIComponent(id)}`
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
    request: CreateSessionRequest
  ): Promise<{ id: string; warnings?: string[] }> {
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
    await this.request(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/archive`
    );
  }

  /**
   * Unarchive a session
   */
  async unarchiveSession(id: string): Promise<void> {
    await this.request(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/unarchive`
    );
  }

  /**
   * Update session metadata (title and/or description)
   */
  async updateSessionMetadata(
    id: string,
    title?: string,
    description?: string
  ): Promise<void> {
    await this.request(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/metadata`,
      { title, description }
    );
  }

  /**
   * Regenerate session metadata using AI
   */
  async regenerateMetadata(id: string): Promise<Session> {
    const response = await this.request<{ session: Session }>(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/regenerate-metadata`
    );
    return response.session;
  }

  /**
   * Refresh a Docker session (pull latest image and recreate container)
   */
  async refreshSession(id: string): Promise<void> {
    await this.request(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/refresh`
    );
  }

  /**
   * Get recent repositories
   */
  async getRecentRepos(): Promise<RecentRepoDto[]> {
    const response = await this.request<{ repos: RecentRepoDto[] }>(
      "GET",
      "/api/recent-repos"
    );
    return response.repos;
  }

  /**
   * Update session access mode
   */
  async updateAccessMode(id: string, mode: AccessMode): Promise<void> {
    await this.request(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/access-mode`,
      { access_mode: mode }
    );
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
   * Get session history (JSONL format)
   *
   * @param id - Session ID
   * @param sinceLine - Optional line number to start from (1-indexed, for incremental updates)
   * @param limit - Optional maximum number of lines to return
   * @returns Session history lines with metadata
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

  /**
   * Upload an image file for a session
   * @param sessionId Session ID
   * @param imageUri Local file URI from image picker
   * @param fileName File name
   */
  async uploadImage(
    sessionId: string,
    imageUri: string,
    fileName: string
  ): Promise<UploadResponse> {
    const formData = new FormData();

    // React Native FormData expects an object with uri, type, and name
    // iOS and macOS need "file://" prefix removed, Android and Windows use as-is
    const normalizedUri =
      Platform.OS === "ios" || Platform.OS === "macos"
        ? imageUri.replace("file://", "")
        : imageUri;

    formData.append("file", {
      uri: normalizedUri,
      type: "image/jpeg", // Default to JPEG, could be improved to detect actual type
      name: fileName,
    } as any);

    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/upload`;

    try {
      const response = await this.fetch(url, {
        method: "POST",
        body: formData,
        headers: {
          // Don't set Content-Type - let browser/RN set it with multipart boundary
        },
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new ApiError(
          data.error ??
            `HTTP ${String(response.status)}: ${response.statusText}`,
          undefined,
          response.status
        );
      }

      return (await response.json()) as UploadResponse;
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
      if (
        response.status === 204 ||
        response.headers.get("content-length") === "0"
      ) {
        return undefined as T;
      }

      // Parse JSON response
      const data: unknown = await response.json();

      // Check for error responses
      if (!response.ok) {
        const errorData = data as { error?: string };
        throw new ApiError(
          errorData.error ??
            `HTTP ${String(response.status)}: ${response.statusText}`,
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
