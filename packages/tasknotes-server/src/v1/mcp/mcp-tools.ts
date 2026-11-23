export type McpToolDefinition = {
  name: string;
  description: string;
  readOnly: boolean;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
  };
  inputSchema: Record<string, unknown>;
};

export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: "facet_get_workspace",
    description:
      "Fetch projects, sections, labels, saved filters, server time, and open/overdue/due-today task counts in a single call. Call this first to learn project and label IDs.",
    readOnly: true,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        tz: {
          type: "string",
          description: "Optional IANA timezone (e.g. America/Los_Angeles)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_list_tasks",
    description:
      "Search and filter tasks by project, section, parent, label, completion status, priority (P1-P4), civil due date bounds, overdue state, or text query.",
    readOnly: true,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        section_id: {
          type: "string",
          description: "Section UUID or 'none' for unsectioned tasks",
        },
        parent_id: {
          type: "string",
          description: "Parent task UUID or 'none' for top-level tasks",
        },
        label_id: { type: "string" },
        completed: { type: "boolean" },
        include_deleted: { type: "boolean" },
        priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        due_before: { type: "string", description: "YYYY-MM-DD" },
        due_on_or_before: { type: "string", description: "YYYY-MM-DD" },
        due_after: { type: "string", description: "YYYY-MM-DD" },
        due_on_or_after: { type: "string", description: "YYYY-MM-DD" },
        overdue: { type: "boolean" },
        tz: { type: "string" },
        q: {
          type: "string",
          description:
            "Case-insensitive search across title, description, and comments",
        },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        offset: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_get_task",
    description:
      "Fetch a single task by ID, including its chronological comments.",
    readOnly: true,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        include_deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_create_task",
    description:
      "Create a new task. Defaults to the Inbox project when project_id is omitted.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        project_id: { type: "string" },
        section_id: { type: "string" },
        parent_id: { type: "string" },
        priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
        child_order: { type: "number" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        due_datetime: { type: "string", description: "RFC 3339 timestamp" },
        due_timezone: { type: "string" },
        due_string: { type: "string" },
        deadline: { type: "string", description: "YYYY-MM-DD" },
        recurrence_rule: {
          type: "string",
          description:
            "RFC 5545 RRULE (e.g. FREQ=DAILY or FREQ=WEEKLY;BYDAY=MO)",
        },
        recurrence_basis: {
          type: "string",
          enum: ["Scheduled", "Completion"],
        },
        label_ids: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_update_task",
    description:
      "Update fields on an existing task. Pass null to clear nullable fields such as due_date, deadline, section_id, parent_id, or recurrence_rule.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        project_id: { type: "string" },
        section_id: { type: ["string", "null"] },
        parent_id: { type: ["string", "null"] },
        priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
        child_order: { type: "number" },
        due_date: { type: ["string", "null"] },
        due_datetime: { type: ["string", "null"] },
        due_timezone: { type: ["string", "null"] },
        due_string: { type: ["string", "null"] },
        deadline: { type: ["string", "null"] },
        recurrence_rule: { type: ["string", "null"] },
        recurrence_basis: {
          type: "string",
          enum: ["Scheduled", "Completion"],
        },
        label_ids: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_complete_task",
    description:
      "Mark a task completed. If the task has an active recurrence_rule, advances it to its next occurrence.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "facet_reopen_task",
    description: "Reopen (uncomplete) a completed task.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "facet_delete_task",
    description: "Soft-delete a task (reversible via facet_restore_task).",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "facet_restore_task",
    description: "Restore a previously soft-deleted task.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "facet_move_tasks",
    description:
      "Atomically move, reparent, or reorder one or more tasks with cycle and project-section validation.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["id", "project_id", "child_order"],
            properties: {
              id: { type: "string" },
              project_id: { type: "string" },
              section_id: { type: "string" },
              parent_id: { type: "string" },
              child_order: { type: "number" },
            },
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_reschedule_tasks",
    description: "Atomically update due dates/datetimes across multiple tasks.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string" },
              due_date: { type: ["string", "null"] },
              due_datetime: { type: ["string", "null"] },
              due_timezone: { type: ["string", "null"] },
              due_string: { type: ["string", "null"] },
            },
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_add_comment",
    description: "Append a chronological comment to a task.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      required: ["task_id", "body"],
      properties: {
        task_id: { type: "string" },
        body: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_delete_comment",
    description: "Delete a comment from a task.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["task_id", "comment_id"],
      properties: {
        task_id: { type: "string" },
        comment_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_manage_organization",
    description:
      "Create, update, or soft-delete a project, section, label, reminder, or saved filter.",
    readOnly: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      required: ["entity_type", "operation"],
      properties: {
        entity_type: {
          type: "string",
          enum: ["project", "section", "label", "reminder", "filter"],
        },
        operation: {
          type: "string",
          enum: ["create", "update", "delete"],
        },
        id: { type: "string", description: "Required for update and delete" },
        data: {
          type: "object",
          description: "Entity fields for create or update",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "facet_list_mutations",
    description:
      "Query the append-only mutation audit log (filterable by actor_kind, token_id, entity_type, entity_id, action, or source).",
    readOnly: true,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        token_id: { type: "string" },
        actor_kind: { type: "string", enum: ["human", "agent"] },
        entity_type: {
          type: "string",
          enum: ["task", "project", "section", "label", "reminder", "filter"],
        },
        entity_id: { type: "string" },
        action: { type: "string" },
        source: { type: "string", enum: ["sync", "rest", "mcp"] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        cursor: { type: "string" },
      },
      additionalProperties: false,
    },
  },
];
