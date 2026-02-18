import { editRepoTool } from "./edit-repo.ts";
import { listReposTool } from "./list-repos.ts";
import { getSessionTool } from "./get-session.ts";
import { approveChangesTool } from "./approve-changes.ts";
import { connectGitHubTool } from "./connect-github.ts";

export { editRepoTool } from "./edit-repo.js";
export { listReposTool } from "./list-repos.js";
export { getSessionTool } from "./get-session.js";
export { approveChangesTool } from "./approve-changes.js";
export { connectGitHubTool } from "./connect-github.js";

export const editorTools = [
  editRepoTool,
  listReposTool,
  getSessionTool,
  approveChangesTool,
  connectGitHubTool,
];
