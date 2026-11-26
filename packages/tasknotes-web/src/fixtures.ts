import {
  Priority,
  type Label,
  type Project,
  type Section,
  type Task,
} from "@shepherdjerred/facet-protocol";
import { emptyWorkspace, type WorkspaceData } from "./sync.ts";

export function task(
  overrides: Partial<Task> & Pick<Task, "id" | "title">,
): Task {
  return {
    user_id: "user",
    project_id: "inbox",
    description: "",
    priority: Priority.P4,
    child_order: 0,
    is_recurring: false,
    label_ids: [],
    completed: false,
    is_deleted: false,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

export function project(
  overrides: Partial<Project> & Pick<Project, "id" | "name">,
): Project {
  return {
    user_id: "user",
    color: "gray",
    child_order: 0,
    is_inbox: false,
    is_favorite: false,
    is_archived: false,
    is_deleted: false,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

export function section(
  overrides: Partial<Section> & Pick<Section, "id" | "name" | "project_id">,
): Section {
  return {
    user_id: "user",
    section_order: 0,
    is_archived: false,
    is_deleted: false,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

export function label(
  overrides: Partial<Label> & Pick<Label, "id" | "name">,
): Label {
  return {
    user_id: "user",
    color: "blue",
    item_order: 0,
    is_favorite: false,
    is_deleted: false,
    ...overrides,
  };
}

export function workspace(input: Partial<WorkspaceData> = {}): WorkspaceData {
  return { ...emptyWorkspace(), ...input };
}
