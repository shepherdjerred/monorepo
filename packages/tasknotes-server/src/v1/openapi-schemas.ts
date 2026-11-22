import { z } from "zod";
import {
  CreateFilterBodySchema,
  CreateLabelBodySchema,
  CreateProjectBodySchema,
  CreateReminderBodySchema,
  CreateSectionBodySchema,
  CreateTaskBodySchema,
  CreateTaskCommentBodySchema,
  RestTaskMoveBodySchema,
  RestTaskRescheduleBodySchema,
  UpdateFilterBodySchema,
  UpdateLabelBodySchema,
  UpdateProjectBodySchema,
  UpdateReminderBodySchema,
  UpdateSectionBodySchema,
  UpdateTaskBodySchema,
} from "./rest-schemas.ts";
import { SyncRequestSchema } from "./schemas.ts";
import { CreateApiTokenBodySchema } from "./token-and-audit-routes.ts";

function zodInputSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  });
  const copy: Record<string, unknown> = { ...raw };
  delete copy["$schema"];
  return copy;
}

function buildEntitySchemas() {
  return {
    Priority: {
      type: "string",
      enum: ["P1", "P2", "P3", "P4"],
      description: "P1 = Urgent, P2 = High, P3 = Medium, P4 = Normal",
    },
    RecurrenceBasis: {
      type: "string",
      enum: ["Scheduled", "Completion"],
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
        due_date: { type: "string", format: "date" },
        due_datetime: { type: "string", format: "date-time" },
        due_timezone: { type: "string" },
        due_string: { type: "string" },
        deadline: { type: "string", format: "date" },
        is_recurring: { type: "boolean" },
        recurrence_rule: { type: "string" },
        recurrence_basis: { $ref: "#/components/schemas/RecurrenceBasis" },
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
    Project: {
      type: "object",
      required: [
        "id",
        "user_id",
        "name",
        "color",
        "child_order",
        "is_inbox",
        "is_favorite",
        "is_archived",
        "is_deleted",
        "created_at",
        "updated_at",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        user_id: { type: "string" },
        name: { type: "string" },
        color: { type: "string" },
        parent_id: { type: "string", format: "uuid" },
        child_order: { type: "number" },
        is_inbox: { type: "boolean" },
        is_favorite: { type: "boolean" },
        is_archived: { type: "boolean" },
        is_deleted: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
      },
    },
    Section: {
      type: "object",
      required: [
        "id",
        "project_id",
        "user_id",
        "name",
        "section_order",
        "is_archived",
        "is_deleted",
        "created_at",
        "updated_at",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        project_id: { type: "string", format: "uuid" },
        user_id: { type: "string" },
        name: { type: "string" },
        section_order: { type: "number" },
        is_archived: { type: "boolean" },
        is_deleted: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
      },
    },
    Label: {
      type: "object",
      required: [
        "id",
        "user_id",
        "name",
        "color",
        "item_order",
        "is_favorite",
        "is_deleted",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        user_id: { type: "string" },
        name: { type: "string" },
        color: { type: "string" },
        item_order: { type: "number" },
        is_favorite: { type: "boolean" },
        is_deleted: { type: "boolean" },
      },
    },
    Reminder: {
      type: "object",
      required: [
        "id",
        "task_id",
        "reminder_type",
        "is_notified",
        "is_deleted",
        "updated_at",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        task_id: { type: "string", format: "uuid" },
        reminder_type: { type: "string" },
        minute_offset: { type: "integer" },
        due_datetime: { type: "string", format: "date-time" },
        is_notified: { type: "boolean" },
        is_deleted: { type: "boolean" },
        updated_at: { type: "string", format: "date-time" },
      },
    },
    Filter: {
      type: "object",
      required: [
        "id",
        "user_id",
        "name",
        "query",
        "color",
        "item_order",
        "is_favorite",
        "is_deleted",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        user_id: { type: "string" },
        name: { type: "string" },
        query: { type: "string" },
        color: { type: "string" },
        item_order: { type: "number" },
        is_favorite: { type: "boolean" },
        is_deleted: { type: "boolean" },
      },
    },
  };
}

function buildAuthAndRequestSchemas() {
  const createSectionSchema = {
    ...zodInputSchema(CreateSectionBodySchema),
    anyOf: [{ required: ["project_id"] }, { required: ["projectId"] }],
  };

  return {
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
    MutationPage: {
      type: "object",
      required: ["items", "next_cursor"],
      properties: {
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/MutationEvent" },
        },
        next_cursor: { type: ["string", "null"] },
      },
    },
    JsonRpcRequest: {
      type: "object",
      required: ["jsonrpc", "method"],
      properties: {
        jsonrpc: { type: "string", const: "2.0" },
        id: { type: ["string", "number", "null"] },
        method: { type: "string", minLength: 1 },
        params: { type: "object" },
      },
    },
    SyncRequest: zodInputSchema(SyncRequestSchema),
    CreateTaskRequest: zodInputSchema(CreateTaskBodySchema),
    UpdateTaskRequest: zodInputSchema(UpdateTaskBodySchema),
    CreateTaskCommentRequest: zodInputSchema(CreateTaskCommentBodySchema),
    MoveTasksRequest: zodInputSchema(RestTaskMoveBodySchema),
    RescheduleTasksRequest: zodInputSchema(RestTaskRescheduleBodySchema),
    CreateProjectRequest: zodInputSchema(CreateProjectBodySchema),
    UpdateProjectRequest: zodInputSchema(UpdateProjectBodySchema),
    CreateSectionRequest: createSectionSchema,
    UpdateSectionRequest: zodInputSchema(UpdateSectionBodySchema),
    CreateLabelRequest: zodInputSchema(CreateLabelBodySchema),
    UpdateLabelRequest: zodInputSchema(UpdateLabelBodySchema),
    CreateReminderRequest: zodInputSchema(CreateReminderBodySchema),
    UpdateReminderRequest: zodInputSchema(UpdateReminderBodySchema),
    CreateFilterRequest: zodInputSchema(CreateFilterBodySchema),
    UpdateFilterRequest: zodInputSchema(UpdateFilterBodySchema),
    CreateApiTokenRequest: zodInputSchema(CreateApiTokenBodySchema),
  };
}

export function pathParam(name: string, description: string) {
  return {
    name,
    in: "path" as const,
    required: true,
    description,
    schema: { type: "string", minLength: 1 },
  };
}

export function jsonRef(schemaName: string) {
  return {
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaName}` },
      },
    },
  };
}

export function jsonArrayRef(schemaName: string) {
  return {
    content: {
      "application/json": {
        schema: {
          type: "array",
          items: { $ref: `#/components/schemas/${schemaName}` },
        },
      },
    },
  };
}

export function jsonRequestBody(schemaName: string) {
  return { required: true, ...jsonRef(schemaName) };
}

export function buildSecondaryEntityPaths(options: {
  basePath: string;
  label: string;
  entitySchema: string;
  createSchema: string;
  updateSchema: string;
  listParams?: Record<string, unknown>[];
}) {
  const updateOp = {
    summary: `Update a ${options.label}`,
    requestBody: jsonRequestBody(options.updateSchema),
    responses: {
      "200": {
        description: `Updated ${options.label}`,
        ...jsonRef(options.entitySchema),
      },
    },
  };

  return {
    [options.basePath]: {
      get: {
        summary: `List active ${options.label}s`,
        ...(options.listParams === undefined
          ? {}
          : { parameters: options.listParams }),
        responses: {
          "200": {
            description: `Active ${options.label}s`,
            ...jsonArrayRef(options.entitySchema),
          },
        },
      },
      post: {
        summary: `Create a ${options.label}`,
        requestBody: jsonRequestBody(options.createSchema),
        responses: {
          "200": {
            description: `Created ${options.label}`,
            ...jsonRef(options.entitySchema),
          },
        },
      },
    },
    [`${options.basePath}/{id}`]: {
      parameters: [pathParam("id", `${options.entitySchema} ID`)],
      get: {
        summary: `Fetch a ${options.label} by ID`,
        responses: {
          "200": {
            description: options.entitySchema,
            ...jsonRef(options.entitySchema),
          },
        },
      },
      patch: updateOp,
      put: updateOp,
      post: updateOp,
      delete: {
        summary: `Soft-delete a ${options.label}`,
        responses: { "204": { description: "Deleted" } },
      },
    },
  };
}

export function buildOpenApiComponents() {
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
      ...buildEntitySchemas(),
      ...buildAuthAndRequestSchemas(),
    },
  };
}
