use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Priority {
    P1, // Urgent (Red)
    P2, // High (Orange)
    P3, // Medium (Blue)
    P4, // Normal (None)
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Task {
    pub id: String,
    pub user_id: String,
    pub project_id: String,
    pub section_id: Option<String>,
    pub parent_id: Option<String>,
    pub title: String,
    pub description: String,
    pub priority: Priority,
    pub child_order: f64,
    pub due_date: Option<String>,
    pub due_datetime: Option<String>,
    pub due_timezone: Option<String>,
    pub due_string: Option<String>,
    pub is_recurring: bool,
    pub recurrence_rule: Option<String>,
    pub completed: bool,
    pub completed_at: Option<String>,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color: String,
    pub parent_id: Option<String>,
    pub child_order: f64,
    pub is_inbox: bool,
    pub is_favorite: bool,
    pub is_archived: bool,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Section {
    pub id: String,
    pub project_id: String,
    pub user_id: String,
    pub name: String,
    pub section_order: f64,
    pub is_archived: bool,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Label {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color: String,
    pub item_order: f64,
    pub is_favorite: bool,
    pub is_deleted: bool,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Reminder {
    pub id: String,
    pub task_id: String,
    pub reminder_type: String,
    pub minute_offset: Option<i32>,
    pub due_datetime: Option<String>,
    pub is_notified: bool,
    pub is_deleted: bool,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Filter {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub query: String,
    pub color: String,
    pub item_order: f64,
    pub is_favorite: bool,
    pub is_deleted: bool,
}

// ── Command Payloads ────────────────────────────────────────────────────────

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskAddArgs {
    pub title: String,
    pub project_id: String,
    pub section_id: Option<String>,
    pub parent_id: Option<String>,
    pub description: Option<String>,
    pub priority: Option<Priority>,
    pub child_order: Option<f64>,
    pub due_date: Option<String>,
    pub due_datetime: Option<String>,
    pub due_timezone: Option<String>,
    pub due_string: Option<String>,
    pub recurrence_rule: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskUpdateArgs {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<Priority>,
    pub project_id: Option<String>,
    pub section_id: Option<String>,
    pub parent_id: Option<String>,
    pub child_order: Option<f64>,
    pub due_date: Option<String>,
    pub due_datetime: Option<String>,
    pub due_timezone: Option<String>,
    pub due_string: Option<String>,
    pub recurrence_rule: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskDeleteArgs {
    pub id: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskCompleteArgs {
    pub id: String,
    pub completed_at: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskUncompleteArgs {
    pub id: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskReorderArgs {
    pub id: String,
    pub child_order: f64,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectAddArgs {
    pub name: String,
    pub color: Option<String>,
    pub parent_id: Option<String>,
    pub child_order: Option<f64>,
    pub is_favorite: Option<bool>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectUpdateArgs {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<String>,
    pub child_order: Option<f64>,
    pub is_favorite: Option<bool>,
    pub is_archived: Option<bool>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectDeleteArgs {
    pub id: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SectionAddArgs {
    pub project_id: String,
    pub name: String,
    pub section_order: Option<f64>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SectionUpdateArgs {
    pub id: String,
    pub name: Option<String>,
    pub section_order: Option<f64>,
    pub is_archived: Option<bool>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SectionDeleteArgs {
    pub id: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LabelAddArgs {
    pub name: String,
    pub color: Option<String>,
    pub item_order: Option<f64>,
    pub is_favorite: Option<bool>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LabelUpdateArgs {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
    pub item_order: Option<f64>,
    pub is_favorite: Option<bool>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LabelDeleteArgs {
    pub id: String,
}

// ── Discriminated Sync Command ──────────────────────────────────────────────

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "args")]
pub enum SyncCommand {
    TaskAdd(TaskAddArgs),
    TaskUpdate(TaskUpdateArgs),
    TaskDelete(TaskDeleteArgs),
    TaskComplete(TaskCompleteArgs),
    TaskUncomplete(TaskUncompleteArgs),
    TaskReorder(TaskReorderArgs),
    ProjectAdd(ProjectAddArgs),
    ProjectUpdate(ProjectUpdateArgs),
    ProjectDelete(ProjectDeleteArgs),
    SectionAdd(SectionAddArgs),
    SectionUpdate(SectionUpdateArgs),
    SectionDelete(SectionDeleteArgs),
    LabelAdd(LabelAddArgs),
    LabelUpdate(LabelUpdateArgs),
    LabelDelete(LabelDeleteArgs),
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QueuedCommand {
    pub uuid: String,
    pub temp_id: Option<String>,
    pub command: SyncCommand,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncRequest {
    pub sync_token: Option<String>,
    pub resource_types: Option<Vec<String>>,
    pub commands: Vec<QueuedCommand>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommandStatus {
    pub status: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncResponse {
    pub sync_token: String,
    pub full_sync: bool,
    pub temp_id_mapping: HashMap<String, String>,
    pub sync_status: HashMap<String, String>,
    pub tasks: Vec<Task>,
    pub projects: Vec<Project>,
    pub sections: Vec<Section>,
    pub labels: Vec<Label>,
    pub reminders: Vec<Reminder>,
    pub filters: Vec<Filter>,
}
