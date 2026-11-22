function buildOpenApiComponents() {
  return {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Pass either a named API token (`Bearer fct_...`) for scoped LLM/integration access or `AUTH_TOKEN` for owner/admin access.",
      },
    },
    schemas: {
      Priority: {
        type: "string",
        enum: ["P1", "P2", "P3", "P4"],
        description: "P1 = Urgent, P2 = High, P3 = Medium, P4 = Normal",
      },
      RecurrenceBasis: {
        type: "string",
        enum: ["Scheduled", "Completion"],
      },
      Task: {
        type: "object",
        required: [
          "id",
          "user_id",
          "project_id",
          "title",
          "description",
          "priority",
          "child_order",
          "is_recurring",
          "label_ids",
          "completed",
          "is_deleted",
          "created_at",
          "updated_at",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string" },
          project_id: { type: "string", format: "uuid" },
          section_id: { type: "string", format: "uuid" },
          parent_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          priority: { $ref: "#/components/schemas/Priority" },
          child_order: { type: "number" },
          due_date: {
            type: "string",
            format: "date",
            description: "Civil date YYYY-MM-DD",
          },
          due_datetime: {
            type: "string",
            format: "date-time",
            description: "RFC 3339 instant",
          },
          due_timezone: {
            type: "string",
            description: "IANA timezone such as America/Los_Angeles",
          },
          due_string: { type: "string" },
          deadline: {
            type: "string",
            format: "date",
            description: "Independent civil deadline YYYY-MM-DD",
          },
          is_recurring: { type: "boolean" },
          recurrence_rule: {
            type: "string",
            description:
              "RFC 5545 RRULE with FREQ=DAILY|WEEKLY|MONTHLY|YEARLY (e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR)",
          },
          recurrence_basis: {
            $ref: "#/components/schemas/RecurrenceBasis",
          },
          label_ids: { type: "array", items: { type: "string" } },
          completed: { type: "boolean" },
          completed_at: { type: "string", format: "date-time" },
          is_deleted: { type: "boolean" },
          comments: {
            type: "array",
            items: { $ref: "#/components/schemas/TaskComment" },
          },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      TaskComment: {
        type: "object",
        required: ["id", "body", "created_at"],
        properties: {
          id: { type: "string", format: "uuid" },
          body: { type: "string" },
          created_at: { type: "string", format: "date-time" },
          file_name: { type: "string" },
        },
      },
      ApiTokenSummary: {
        type: "object",
        required: [
          "id",
          "user_id",
          "name",
          "actor_kind",
          "token_prefix",
          "scopes",
          "created_at",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string" },
          name: { type: "string" },
          actor_kind: { type: "string", enum: ["human", "agent"] },
          token_prefix: { type: "string" },
          scopes: {
            type: "array",
            items: { type: "string", enum: ["read", "write"] },
          },
          expires_at: { type: ["string", "null"], format: "date-time" },
          revoked_at: { type: ["string", "null"], format: "date-time" },
          last_used_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      MutationEvent: {
        type: "object",
        required: [
          "id",
          "user_id",
          "sync_seq",
          "entity_type",
          "entity_id",
          "action",
          "source",
          "request_id",
          "actor_kind",
          "actor_name",
          "changes",
          "created_at",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string" },
          sync_seq: { type: "string" },
          entity_type: {
            type: "string",
            enum: ["task", "project", "section", "label", "reminder", "filter"],
          },
          entity_id: { type: "string" },
          action: { type: "string" },
          source: { type: "string", enum: ["sync", "rest", "mcp"] },
          command_uuid: { type: ["string", "null"] },
          request_id: { type: "string", format: "uuid" },
          actor_kind: { type: "string", enum: ["human", "agent"] },
          actor_name: { type: "string" },
          token_id: { type: ["string", "null"] },
          token_prefix: { type: ["string", "null"] },
          actor_metadata: { type: ["object", "null"] },
          changes: { type: "object" },
          before: { type: ["object", "null"] },
          after: { type: ["object", "null"] },
          created_at: { type: "string", format: "date-time" },
        },
      },
    },
  };
}

function buildOpenApiPaths() {
  return {
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
          {
            name: "tz",
            in: "query",
            schema: { type: "string" },
            description:
              "Optional IANA timezone for civil today/overdue calculation",
          },
        ],
        responses: {
          "200": { description: "Workspace taxonomy and counts" },
        },
      },
    },
    "/api/v1/tasks": {
      get: {
        summary: "Query tasks with rich filters",
        parameters: [
          { name: "project_id", in: "query", schema: { type: "string" } },
          {
            name: "section_id",
            in: "query",
            schema: { type: "string" },
            description: "Section UUID or 'none' for unsectioned tasks",
          },
          {
            name: "parent_id",
            in: "query",
            schema: { type: "string" },
            description: "Parent task UUID or 'none' for root tasks",
          },
          { name: "label_id", in: "query", schema: { type: "string" } },
          {
            name: "completed",
            in: "query",
            schema: { type: "string", enum: ["true", "false"] },
          },
          {
            name: "priority",
            in: "query",
            schema: { $ref: "#/components/schemas/Priority" },
          },
          {
            name: "due_date",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "due_before",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "due_on_or_before",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "due_after",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "due_on_or_after",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "overdue",
            in: "query",
            schema: { type: "string", enum: ["true", "false"] },
          },
          { name: "tz", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 500 },
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", minimum: 0 },
          },
        ],
        responses: { "200": { description: "Matching tasks" } },
      },
      post: {
        summary: "Create a task (defaults to Inbox if project_id is omitted)",
        responses: { "200": { description: "Created task" } },
      },
    },
    "/api/v1/tasks/{id}": {
      get: {
        summary: "Fetch a task by ID",
        responses: { "200": { description: "Task" } },
      },
      patch: {
        summary: "Update fields on a task",
        responses: { "200": { description: "Updated task" } },
      },
      delete: {
        summary: "Soft-delete a task",
        responses: { "204": { description: "Deleted" } },
      },
    },
    "/api/v1/tasks/{id}/close": {
      post: {
        summary: "Complete a task (advances next occurrence if recurring)",
        responses: { "204": { description: "Completed" } },
      },
    },
    "/api/v1/tasks/{id}/reopen": {
      post: {
        summary: "Reopen a completed task",
        responses: { "204": { description: "Reopened" } },
      },
    },
    "/api/v1/tasks/{id}/restore": {
      post: {
        summary: "Restore a soft-deleted task",
        responses: { "200": { description: "Restored task" } },
      },
    },
    "/api/v1/tasks/move": {
      post: {
        summary: "Atomically move/reparent/reorder tasks",
        responses: { "200": { description: "Move summary" } },
      },
    },
    "/api/v1/tasks/reschedule": {
      post: {
        summary: "Atomically reschedule multiple tasks",
        responses: { "200": { description: "Updated tasks" } },
      },
    },
    "/api/v1/tasks/{id}/comments": {
      get: {
        summary: "List chronological comments on a task",
        responses: { "200": { description: "Comments" } },
      },
      post: {
        summary: "Append a comment to a task",
        responses: { "201": { description: "Created comment" } },
      },
    },
    "/api/v1/tasks/{id}/comments/{commentId}": {
      delete: {
        summary: "Delete a comment from a task",
        responses: { "204": { description: "Deleted" } },
      },
    },
    "/api/v1/projects": {
      get: {
        summary: "List active projects",
        responses: { "200": { description: "Projects" } },
      },
      post: {
        summary: "Create a project",
        responses: { "200": { description: "Created project" } },
      },
    },
    "/api/v1/sections": {
      get: {
        summary: "List active sections (optional ?project_id=)",
        responses: { "200": { description: "Sections" } },
      },
      post: {
        summary: "Create a section in a project",
        responses: { "200": { description: "Created section" } },
      },
    },
    "/api/v1/labels": {
      get: {
        summary: "List active labels",
        responses: { "200": { description: "Labels" } },
      },
      post: {
        summary: "Create a label",
        responses: { "200": { description: "Created label" } },
      },
    },
    "/api/v1/reminders": {
      get: {
        summary: "List active reminders (optional ?task_id=)",
        responses: { "200": { description: "Reminders" } },
      },
      post: {
        summary: "Create a reminder",
        responses: { "200": { description: "Created reminder" } },
      },
    },
    "/api/v1/filters": {
      get: {
        summary: "List active saved filters",
        responses: { "200": { description: "Filters" } },
      },
      post: {
        summary: "Create a saved filter",
        responses: { "200": { description: "Created filter" } },
      },
    },
    "/api/v1/mutations": {
      get: {
        summary: "Query the append-only mutation audit ledger",
        parameters: [
          { name: "token_id", in: "query", schema: { type: "string" } },
          {
            name: "actor_kind",
            in: "query",
            schema: { type: "string", enum: ["human", "agent"] },
          },
          { name: "actor_name", in: "query", schema: { type: "string" } },
          { name: "entity_type", in: "query", schema: { type: "string" } },
          { name: "entity_id", in: "query", schema: { type: "string" } },
          { name: "action", in: "query", schema: { type: "string" } },
          {
            name: "source",
            in: "query",
            schema: { type: "string", enum: ["sync", "rest", "mcp"] },
          },
          {
            name: "since",
            in: "query",
            schema: { type: "string", format: "date-time" },
          },
          { name: "since_seq", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 200 },
          },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Paginated mutation audit events" },
        },
      },
    },
    "/api/v1/tokens": {
      get: {
        summary: "List API tokens (admin AUTH_TOKEN only)",
        responses: { "200": { description: "API tokens" } },
      },
      post: {
        summary: "Mint a named API token (admin AUTH_TOKEN only)",
        responses: {
          "201": { description: "Created token secret + metadata" },
        },
      },
    },
    "/api/v1/tokens/{id}": {
      delete: {
        summary: "Revoke an API token (admin AUTH_TOKEN only)",
        responses: { "200": { description: "Revoked token metadata" } },
      },
    },
    "/api/v1/mcp": {
      post: {
        summary:
          "Stateless Streamable HTTP Model Context Protocol (MCP) JSON-RPC 2.0 endpoint",
        responses: { "200": { description: "JSON-RPC 2.0 response" } },
      },
    },
  };
}

export function buildOpenApiDocument(serverUrl?: string) {
  const servers =
    serverUrl !== undefined && serverUrl !== "" ? [{ url: serverUrl }] : [];

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
