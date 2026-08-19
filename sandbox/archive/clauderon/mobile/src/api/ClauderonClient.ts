import { z } from "zod";
import type {
  Session,
  CreateSessionRequest,
  RecentRepoDto,
  SystemStatus,
  UploadResponse,
} from "../types/generated";
import { ApiError, NetworkError, SessionNotFoundError } from "./errors";
import { Platform } from "react-native";
import { ErrorResponseSchema, UploadResponseSchema } from "../lib/schemas";

// Schemas for API response wrappers using z.custom for complex generated types
const SessionsResponseSchema = z.object({ sessions: z.array(z.custom<Session>()) });
const SessionResponseSchema = z.object({ session: z.custom<Session>() });
const CreateResponseSchema = z.object({
  id: z.string(),
  warnings: z.array(z.string()).optional(),
});
const RecentReposResponseSchema = z.object({ repos: z.array(z.custom<RecentRepoDto>()) });
const SystemStatusResponseSchema = z.custom<SystemStatus>();
const HistoryResponseSchema = z.object({
  lines: z.array(z.string()),
  total_lines: z.number(),
  file_exists: z.boolean(),
});

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
  fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

/**
 * Type-safe HTTP client for the Clauderon API
 */
export class ClauderonClient {
  private readonly baseUrl: string;
  private readonly fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;

  constructor(config: ClauderonClientConfig) {
    this.baseUrl = config.baseUrl;
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<Session[]> {
    const response = SessionsResponseSchema.parse(await this.requestJson("GET", "/api/sessions"));
    return response.sessions;
  }

  /**
   * Get a specific session by ID or name
   */
  async getSession(id: string): Promise<Session> {
    try {
      const response = SessionResponseSchema.parse(
        await this.requestJson("GET", `/api/sessions/${encodeURIComponent(id)}`),
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
  ): Promise<{ id: string; warnings?: string[] | undefined }> {
    return CreateResponseSchema.parse(await this.requestJson("POST", "/api/sessions", request));
  }

  /**
   * Delete a session
   */
  async deleteSession(id: string): Promise<void> {
    await this.requestVoid("DELETE", `/api/sessions/${encodeURIComponent(id)}`);
  }

  /**
   * Archive a session
   */
  async archiveSession(id: string): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/archive`);
  }

  /**
   * Unarchive a session
   */
  async unarchiveSession(id: string): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/unarchive`);
  }

  /**
   * Update session metadata (title and/or description)
   */
  async updateSessionMetadata(id: string, title?: string, description?: string): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/metadata`, {
      title,
      description,
    });
  }

  /**
   * Regenerate session metadata using AI
   */
  async regenerateMetadata(id: string): Promise<Session> {
    const response = SessionResponseSchema.parse(
      await this.requestJson("POST", `/api/sessions/${encodeURIComponent(id)}/regenerate-metadata`),
    );
    return response.session;
  }

  /**
   * Refresh a Docker session (pull latest image and recreate container)
   */
  async refreshSession(id: string): Promise<void> {
    await this.requestVoid("POST", `/api/sessions/${encodeURIComponent(id)}/refresh`);
  }

  /**
   * Get recent repositories
   */
  async getRecentRepos(): Promise<RecentRepoDto[]> {
    const response = RecentReposResponseSchema.parse(
      await this.requestJson("GET", "/api/recent-repos"),
    );
    return response.repos;
  }

  /**
   * Get system status
   */
  async getSystemStatus(): Promise<SystemStatus> {
    return SystemStatusResponseSchema.parse(await this.requestJson("GET", "/api/status"));
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

    const response = HistoryResponseSchema.parse(await this.requestJson("GET", url));

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
    fileName: string,
  ): Promise<UploadResponse> {
    const formData = new FormData();

    // React Native FormData expects an object with uri, type, and name
    // iOS and macOS need "file://" prefix removed, Android and Windows use as-is
    const normalizedUri =
      Platform.OS === "ios" || Platform.OS === "macos" ? imageUri.replace("file://", "") : imageUri;

    // React Native's FormData accepts RN-specific file objects via the extended type declaration
    formData.append("file", {
      uri: normalizedUri,
      type: "image/jpeg",
      name: fileName,
    });

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
        const data = ErrorResponseSchema.parse(await response.json());
        throw new ApiError(
          data.error ?? `HTTP ${String(response.status)}: ${response.statusText}`,
          undefined,
          response.status,
        );
      }

      return UploadResponseSchema.parse(await response.json());
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
   * Internal method to make HTTP requests that return no body
   */
  private async requestVoid(method: string, path: string, body?: unknown): Promise<void> {
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

      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return;
      }

      const data: unknown = await response.json();

      if (!response.ok) {
        const errorData = ErrorResponseSchema.parse(data);
        throw new ApiError(
          errorData.error ?? `HTTP ${String(response.status)}: ${response.statusText}`,
          undefined,
          response.status,
        );
      }
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

  /**
   * Internal method to make HTTP requests that return JSON
   */
  private async requestJson(method: string, path: string, body?: unknown): Promise<unknown> {
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

      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return undefined;
      }

      const data: unknown = await response.json();

      if (!response.ok) {
        const errorData = ErrorResponseSchema.parse(data);
        throw new ApiError(
          errorData.error ?? `HTTP ${String(response.status)}: ${response.statusText}`,
          undefined,
          response.status,
        );
      }

      return data;
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
