import { describe, expect, test, mock } from "bun:test";
import { ClauderonClient } from "./clauderon-client.ts";
import { ApiError, NetworkError, SessionNotFoundError } from "./errors.ts";
import {
  SessionStatus,
  AccessMode,
  BackendType,
  AgentType,
  ClaudeWorkingStatus,
} from "@clauderon/shared";
import type { Session, CreateSessionRequest } from "@clauderon/shared";

// Helper to create a mock fetch function
function createMockFetch(
  responses: Map<string, { status: number; body?: unknown }>,
) {
  return mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;

    const response = responses.get(key);
    if (!response) {
      throw new Error(`Unexpected fetch call: ${key}`);
    }

    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status === 200 ? "OK" : "Error",
      headers: new Headers({
        "content-length": response.body ? "1" : "0",
      }),
      json: () => Promise.resolve(response.body),
    } as Response);
  });
}

// Helper to create a valid mock session
function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session1",
    name: "Test Session",
    status: SessionStatus.Running,
    backend: BackendType.Zellij,
    agent: AgentType.ClaudeCode,
    repo_path: "/tmp/repo",
    worktree_path: "/tmp/worktree",
    branch_name: "main",
    initial_prompt: "test prompt",
    dangerous_skip_checks: false,
    dangerous_copy_creds: false,
    claude_status: ClaudeWorkingStatus.Unknown,
    access_mode: AccessMode.ReadWrite,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ClauderonClient", () => {
  describe("constructor", () => {
    test("uses default baseUrl when not provided", () => {
      const client = new ClauderonClient();
      // In non-browser context, defaults to localhost:3030
      expect(client).toBeDefined();
    });

    test("uses provided baseUrl", () => {
      const client = new ClauderonClient({ baseUrl: "http://custom:8080" });
      expect(client).toBeDefined();
    });
  });

  describe("listSessions", () => {
    test("returns list of sessions", async () => {
      const mockSessions = [createMockSession()];

      const mockFetch = createMockFetch(
        new Map([
          [
            "GET http://localhost:3030/api/sessions",
            { status: 200, body: { sessions: mockSessions } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const sessions = await client.listSessions();

      expect(sessions).toEqual(mockSessions);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("throws NetworkError on fetch failure", async () => {
      const mockFetch = mock(() =>
        Promise.reject(new Error("Network failure")),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });

      await expect(client.listSessions()).rejects.toThrow(NetworkError);
    });
  });

  describe("getSession", () => {
    test("returns session by id", async () => {
      const mockSession = createMockSession();

      const mockFetch = createMockFetch(
        new Map([
          [
            "GET http://localhost:3030/api/sessions/session1",
            { status: 200, body: { session: mockSession } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const session = await client.getSession("session1");

      expect(session).toEqual(mockSession);
    });

    test("throws SessionNotFoundError for 404", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "GET http://localhost:3030/api/sessions/nonexistent",
            { status: 404, body: { error: "Not found" } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });

      await expect(client.getSession("nonexistent")).rejects.toThrow(
        SessionNotFoundError,
      );
    });

    test("encodes session id in URL", async () => {
      const mockSession = createMockSession({ id: "session/with/slashes" });

      const mockFetch = createMockFetch(
        new Map([
          [
            "GET http://localhost:3030/api/sessions/session%2Fwith%2Fslashes",
            { status: 200, body: { session: mockSession } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const session = await client.getSession("session/with/slashes");

      expect(session.id).toBe("session/with/slashes");
    });
  });

  describe("createSession", () => {
    test("creates session and returns id", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions",
            { status: 200, body: { id: "new-session" } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const request: CreateSessionRequest = {
        name: "New Session",
        repo_path: "/tmp/repo",
        initial_prompt: "test",
        backend: BackendType.Zellij,
        agent: AgentType.ClaudeCode,
        dangerous_skip_checks: false,
        plan_mode: false,
      };
      const result = await client.createSession(request);

      expect(result.id).toBe("new-session");
    });

    test("returns warnings if present", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions",
            {
              status: 200,
              body: { id: "new-session", warnings: ["Warning 1"] },
            },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const request: CreateSessionRequest = {
        name: "New Session",
        repo_path: "/tmp/repo",
        initial_prompt: "test",
        backend: BackendType.Zellij,
        agent: AgentType.ClaudeCode,
        dangerous_skip_checks: false,
        plan_mode: false,
      };
      const result = await client.createSession(request);

      expect(result.warnings).toEqual(["Warning 1"]);
    });
  });

  describe("deleteSession", () => {
    test("deletes session successfully", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "DELETE http://localhost:3030/api/sessions/session1",
            { status: 204 },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(client.deleteSession("session1")).resolves.toBeUndefined();
    });
  });

  describe("archiveSession", () => {
    test("archives session successfully", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/archive",
            { status: 204 },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(client.archiveSession("session1")).resolves.toBeUndefined();
    });
  });

  describe("getRecentRepos", () => {
    test("returns list of recent repos", async () => {
      const mockRepos = [
        { repo_path: "/path/to/repo1", last_used: "2024-01-01T00:00:00Z" },
        { repo_path: "/path/to/repo2", last_used: "2024-01-02T00:00:00Z" },
      ];

      const mockFetch = createMockFetch(
        new Map([
          [
            "GET http://localhost:3030/api/recent-repos",
            { status: 200, body: { repos: mockRepos } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const repos = await client.getRecentRepos();

      expect(repos).toEqual(mockRepos);
    });
  });

  describe("updateAccessMode", () => {
    test("updates access mode successfully", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/access-mode",
            { status: 204 },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(
        client.updateAccessMode("session1", AccessMode.ReadWrite),
      ).resolves.toBeUndefined();
    });
  });

  describe("error handling", () => {
    test("throws ApiError for non-404 errors", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "GET http://localhost:3030/api/sessions",
            { status: 500, body: { error: "Internal error" } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });

      try {
        await client.listSessions();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).statusCode).toBe(500);
      }
    });
  });

  describe("getHealth", () => {
    test("returns health check result for all sessions", async () => {
      const mockHealth = {
        sessions: [
          {
            session_id: "session1",
            session_name: "Test Session",
            backend_type: "Docker",
            state: { type: "Healthy" },
            available_actions: ["Recreate", "UpdateImage"],
            recommended_action: null,
            description: "Container is running",
            details: "Docker container abc123 is healthy",
            data_safe: true,
          },
        ],
        healthy_count: 1,
        needs_attention_count: 0,
        blocked_count: 0,
      };

      const mockFetch = createMockFetch(
        new Map([
          [
            "GET http://localhost:3030/api/health",
            { status: 200, body: mockHealth },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const result = await client.getHealth();

      expect(result.sessions).toHaveLength(1);
      expect(result.healthy_count).toBe(1);
      expect(result.sessions[0]?.session_id).toBe("session1");
    });
  });

  describe("getSessionHealth", () => {
    test("returns health report for single session", async () => {
      const mockReport = {
        session_id: "session1",
        session_name: "Test Session",
        backend_type: "Docker",
        state: { type: "Missing" },
        available_actions: ["Recreate"],
        recommended_action: "Recreate",
        description: "Container not found",
        details: "Docker container was deleted externally",
        data_safe: true,
      };

      const mockFetch = createMockFetch(
        new Map([
          [
            "GET http://localhost:3030/api/sessions/session1/health",
            { status: 200, body: mockReport },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const result = await client.getSessionHealth("session1");

      expect(result.session_id).toBe("session1");
      expect(result.state.type).toBe("Missing");
      expect(result.available_actions).toContain("Recreate");
    });
  });

  describe("startSession", () => {
    test("starts a stopped session successfully", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/start",
            { status: 204 },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(client.startSession("session1")).resolves.toBeUndefined();
    });

    test("throws ApiError when session cannot be started", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/start",
            { status: 400, body: { error: "Session is not in stopped state" } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(client.startSession("session1")).rejects.toThrow(ApiError);
    });
  });

  describe("wakeSession", () => {
    test("wakes a hibernated session successfully", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/wake",
            { status: 204 },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(client.wakeSession("session1")).resolves.toBeUndefined();
    });

    test("throws ApiError when session cannot be woken", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/wake",
            { status: 400, body: { error: "Session is not hibernated" } },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(client.wakeSession("session1")).rejects.toThrow(ApiError);
    });
  });

  describe("recreateSession", () => {
    test("recreates session and returns result", async () => {
      const mockResult = {
        session_id: "session1",
        new_backend_id: "container-xyz",
        success: true,
        message: "Session recreated successfully",
      };

      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/recreate",
            { status: 200, body: mockResult },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      const result = await client.recreateSession("session1");

      expect(result.success).toBe(true);
      expect(result.new_backend_id).toBe("container-xyz");
    });

    test("throws ApiError with 409 when recreate is blocked", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/recreate",
            {
              status: 409,
              body: { error: "Cannot recreate: data would be lost" },
            },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });

      try {
        await client.recreateSession("session1");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).statusCode).toBe(409);
      }
    });
  });

  describe("cleanupSession", () => {
    test("cleans up session successfully", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/cleanup",
            { status: 204 },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(client.cleanupSession("session1")).resolves.toBeUndefined();
    });

    test("throws ApiError when cleanup fails", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "POST http://localhost:3030/api/sessions/session1/cleanup",
            {
              status: 400,
              body: { error: "Session still has active resources" },
            },
          ],
        ]),
      );

      const client = new ClauderonClient({
        baseUrl: "http://localhost:3030",
        fetch: mockFetch,
      });
      await expect(client.cleanupSession("session1")).rejects.toThrow(ApiError);
    });
  });
});
