import {
  buildOpenApiComponents,
  buildSecondaryEntityPaths,
  jsonArrayRef,
  jsonRef,
  jsonRequestBody,
  pathParam,
} from "./openapi-schemas.ts";

function queryParam(
  name: string,
  schema: Record<string, unknown>,
  description?: string,
) {
  return {
    name,
    in: "query" as const,
    schema,
    ...(description === undefined ? {} : { description }),
  };
}

function mutationFilterQueryParams(includeEntity = true) {
  const entityParams = includeEntity
    ? [
        queryParam("entity_type", { type: "string" }),
        queryParam("entity_id", { type: "string" }),
      ]
    : [];
  return [
    queryParam("token_id", { type: "string" }),
    queryParam("actor_kind", { type: "string", enum: ["human", "agent"] }),
    queryParam("actor_name", { type: "string" }),
    ...entityParams,
    queryParam("action", { type: "string" }),
    queryParam("source", { type: "string", enum: ["sync", "rest", "mcp"] }),
    queryParam("since", { type: "string", format: "date-time" }),
    queryParam("since_seq", { type: "string" }),
    queryParam("limit", { type: "integer", minimum: 1, maximum: 200 }),
    queryParam("cursor", { type: "string" }),
  ];
}

function taskListQueryParams() {
  const boolEnum = { type: "string", enum: ["true", "false"] };
  const isoDate = { type: "string", format: "date" };
  return [
    queryParam("project_id", { type: "string" }),
    queryParam(
      "section_id",
      { type: "string" },
      "Section UUID or 'none' for unsectioned tasks",
    ),
    queryParam(
      "parent_id",
      { type: "string" },
      "Parent task UUID or 'none' for root tasks",
    ),
    queryParam("label_id", { type: "string" }),
    queryParam("completed", boolEnum),
    queryParam("include_deleted", boolEnum),
    queryParam("priority", { $ref: "#/components/schemas/Priority" }),
    queryParam("due_date", isoDate),
    queryParam("due_before", isoDate),
    queryParam("due_on_or_before", isoDate),
    queryParam("due_after", isoDate),
    queryParam("due_on_or_after", isoDate),
    queryParam("deadline_before", isoDate),
    queryParam("deadline_after", isoDate),
    queryParam("overdue", boolEnum),
    queryParam("tz", { type: "string" }),
    queryParam("q", { type: "string" }),
    queryParam("search", { type: "string" }),
    queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }),
    queryParam("offset", { type: "integer", minimum: 0 }),
  ];
}

function buildTaskPaths() {
  const taskIdParam = pathParam("id", "Task ID");
  const commentIdParam = pathParam("commentId", "Comment UUID");
  const updateTaskOp = {
    summary: "Update fields on a task",
    requestBody: jsonRequestBody("UpdateTaskRequest"),
    responses: {
      "200": { description: "Updated task", ...jsonRef("Task") },
    },
  };

  return {
    "/api/v1/tasks": {
      get: {
        summary: "Query tasks with rich filters",
        parameters: taskListQueryParams(),
        responses: {
          "200": { description: "Matching tasks", ...jsonArrayRef("Task") },
        },
      },
      post: {
        summary: "Create a task (defaults to Inbox if project_id is omitted)",
        requestBody: jsonRequestBody("CreateTaskRequest"),
        responses: {
          "200": { description: "Created task", ...jsonRef("Task") },
        },
      },
    },
    "/api/v1/tasks/{id}": {
      parameters: [taskIdParam],
      get: {
        summary: "Fetch a task by ID",
        parameters: [
          queryParam("include_deleted", {
            type: "string",
            enum: ["true", "false"],
          }),
        ],
        responses: { "200": { description: "Task", ...jsonRef("Task") } },
      },
      patch: updateTaskOp,
      put: updateTaskOp,
      post: updateTaskOp,
      delete: {
        summary: "Soft-delete a task",
        responses: { "204": { description: "Deleted" } },
      },
    },
    "/api/v1/tasks/{id}/close": {
      parameters: [taskIdParam],
      post: {
        summary: "Complete a task (advances next occurrence if recurring)",
        responses: { "204": { description: "Completed" } },
      },
    },
    "/api/v1/tasks/{id}/reopen": {
      parameters: [taskIdParam],
      post: {
        summary: "Reopen a completed task",
        responses: { "204": { description: "Reopened" } },
      },
    },
    "/api/v1/tasks/{id}/restore": {
      parameters: [taskIdParam],
      post: {
        summary: "Restore a soft-deleted task",
        responses: {
          "200": { description: "Restored task", ...jsonRef("Task") },
        },
      },
    },
    "/api/v1/tasks/move": {
      post: {
        summary: "Atomically move/reparent/reorder tasks",
        requestBody: jsonRequestBody("MoveTasksRequest"),
        responses: {
          "200": {
            description: "Move summary",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["ok", "moved"],
                  properties: {
                    ok: { type: "boolean" },
                    moved: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/tasks/reschedule": {
      post: {
        summary: "Atomically reschedule multiple tasks",
        requestBody: jsonRequestBody("RescheduleTasksRequest"),
        responses: {
          "200": {
            description: "Updated tasks",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Task" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/tasks/{id}/comments": {
      parameters: [taskIdParam],
      get: {
        summary: "List chronological comments on a task",
        responses: {
          "200": { description: "Comments", ...jsonArrayRef("TaskComment") },
        },
      },
      post: {
        summary: "Append a comment to a task",
        requestBody: jsonRequestBody("CreateTaskCommentRequest"),
        responses: {
          "201": { description: "Created comment", ...jsonRef("TaskComment") },
        },
      },
    },
    "/api/v1/tasks/{id}/comments/{commentId}": {
      parameters: [taskIdParam, commentIdParam],
      delete: {
        summary: "Delete a comment from a task",
        responses: { "204": { description: "Deleted" } },
      },
    },
    "/api/v1/tasks/{taskId}/comments/{commentId}/file": {
      parameters: [pathParam("taskId", "Task ID"), commentIdParam],
      get: {
        summary: "Download a comment attachment",
        responses: {
          "200": {
            description: "Attachment bytes",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
        },
      },
    },
    "/api/v1/tasks/{id}/mutations": {
      parameters: [taskIdParam],
      get: {
        summary: "Query mutation audit history for a single task",
        parameters: mutationFilterQueryParams(false),
        responses: {
          "200": {
            description: "Paginated task mutation events",
            ...jsonRef("MutationPage"),
          },
        },
      },
    },
  };
}

function buildTokenAndMcpPaths() {
  const tokenRef = { $ref: "#/components/schemas/ApiTokenSummary" };
  return {
    "/api/v1/mutations": {
      get: {
        summary: "Query the append-only mutation audit ledger",
        parameters: mutationFilterQueryParams(true),
        responses: {
          "200": {
            description: "Paginated mutation audit events",
            ...jsonRef("MutationPage"),
          },
        },
      },
    },
    "/api/v1/tokens": {
      get: {
        summary: "List API tokens (admin AUTH_TOKEN only)",
        parameters: [
          queryParam("include_revoked", {
            type: "string",
            enum: ["true", "false"],
          }),
        ],
        responses: {
          "200": {
            description: "API tokens",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: { items: { type: "array", items: tokenRef } },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Mint a named API token (admin AUTH_TOKEN only)",
        requestBody: jsonRequestBody("CreateApiTokenRequest"),
        responses: {
          "201": {
            description: "Created token secret + metadata",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["token", "api_token"],
                  properties: {
                    token: { type: "string" },
                    api_token: tokenRef,
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/tokens/{id}": {
      parameters: [pathParam("id", "API token ID")],
      delete: {
        summary: "Revoke an API token (admin AUTH_TOKEN only)",
        responses: {
          "200": {
            description: "Revoked token metadata",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["api_token"],
                  properties: { api_token: tokenRef },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/mcp": {
      post: {
        summary:
          "Stateless Streamable HTTP Model Context Protocol (MCP) JSON-RPC 2.0 endpoint",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/JsonRpcRequest" },
                  {
                    type: "array",
                    minItems: 1,
                    items: { $ref: "#/components/schemas/JsonRpcRequest" },
                  },
                ],
              },
            },
          },
        },
        responses: {
          "200": { description: "JSON-RPC 2.0 response or batch response" },
          "202": { description: "Accepted notification" },
        },
      },
    },
  };
}

function buildOpenApiPaths() {
  return {
    "/api/v1/openapi.json": {
      get: {
        summary: "Fetch this OpenAPI 3.1.0 specification",
        responses: { "200": { description: "OpenAPI 3.1.0 document" } },
      },
    },
    "/api/v1/whoami": {
      get: {
        summary: "Inspect the authenticated principal and token scopes",
        responses: { "200": { description: "Resolved principal details" } },
      },
    },
    "/api/v1/workspace": {
      get: {
        summary:
          "Load projects, sections, labels, saved filters, server time, and task counts in one call",
        parameters: [
          queryParam(
            "tz",
            { type: "string" },
            "Optional IANA timezone for civil today/overdue calculation",
          ),
        ],
        responses: { "200": { description: "Workspace taxonomy and counts" } },
      },
    },
    "/api/v1/sync": {
      post: {
        summary: "Execute delta sync commands and pull incremental state",
        requestBody: jsonRequestBody("SyncRequest"),
        responses: { "200": { description: "Sync delta response" } },
      },
    },
    ...buildTaskPaths(),
    ...buildSecondaryEntityPaths({
      basePath: "/api/v1/projects",
      label: "project",
      entitySchema: "Project",
      createSchema: "CreateProjectRequest",
      updateSchema: "UpdateProjectRequest",
    }),
    ...buildSecondaryEntityPaths({
      basePath: "/api/v1/sections",
      label: "section",
      entitySchema: "Section",
      createSchema: "CreateSectionRequest",
      updateSchema: "UpdateSectionRequest",
      listParams: [queryParam("project_id", { type: "string" })],
    }),
    ...buildSecondaryEntityPaths({
      basePath: "/api/v1/labels",
      label: "label",
      entitySchema: "Label",
      createSchema: "CreateLabelRequest",
      updateSchema: "UpdateLabelRequest",
    }),
    ...buildSecondaryEntityPaths({
      basePath: "/api/v1/reminders",
      label: "reminder",
      entitySchema: "Reminder",
      createSchema: "CreateReminderRequest",
      updateSchema: "UpdateReminderRequest",
      listParams: [queryParam("task_id", { type: "string" })],
    }),
    ...buildSecondaryEntityPaths({
      basePath: "/api/v1/filters",
      label: "filter",
      entitySchema: "Filter",
      createSchema: "CreateFilterRequest",
      updateSchema: "UpdateFilterRequest",
    }),
    ...buildTokenAndMcpPaths(),
  };
}

export function buildOpenApiDocument(serverUrl?: string) {
  const servers =
    serverUrl === undefined || serverUrl === "" ? [] : [{ url: serverUrl }];

  return {
    openapi: "3.1.0",
    info: {
      title: "Facet API",
      version: "0.1.0",
      description:
        "Personal task management API supporting named LLM API tokens (fct_*), rich REST operations, Todoist-style delta sync (/api/v1/sync), Streamable HTTP MCP (/api/v1/mcp), and transactional mutation audit tracking (/api/v1/mutations). Start with GET /api/v1/workspace to load projects, sections, labels, saved filters, and current task counts in a single request.",
    },
    ...(servers.length > 0 ? { servers } : {}),
    security: [{ bearerAuth: [] }],
    components: buildOpenApiComponents(),
    paths: buildOpenApiPaths(),
  };
}
