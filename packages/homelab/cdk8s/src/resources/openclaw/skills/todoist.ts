export const todoistSkill = `---
name: todoist
description: Manage tasks and projects in Todoist
metadata:
  openclaw:
    requires:
      env: ["TODOIST_API_KEY"]
---
# Todoist

Use curl with Todoist REST API v2 at https://api.todoist.com/rest/v2

## Authentication
Authorization: Bearer $TODOIST_API_KEY

## Common Operations
- List tasks: GET /tasks
- Create task: POST /tasks {"content": "...", "due_string": "tomorrow"}
- Complete task: POST /tasks/{id}/close
- List projects: GET /projects
`;
