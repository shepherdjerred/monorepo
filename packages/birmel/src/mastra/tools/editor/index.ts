import { editRepoTool } from "./edit-repo.js";
import { listReposTool } from "./list-repos.js";
import { getSessionTool } from "./get-session.js";
import { approveChangesTool } from "./approve-changes.js";

export { editRepoTool } from "./edit-repo.js";
export { listReposTool } from "./list-repos.js";
export { getSessionTool } from "./get-session.js";
export { approveChangesTool } from "./approve-changes.js";

export const editorTools = [
  editRepoTool,
  listReposTool,
  getSessionTool,
  approveChangesTool,
];
