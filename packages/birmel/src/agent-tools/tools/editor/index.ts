import { editRepoTool } from "./edit-repo.ts";
import { listReposTool } from "./list-repos.ts";
import { getSessionTool } from "./get-session.ts";
import { approveChangesTool } from "./approve-changes.ts";
import { connectGitHubTool } from "./connect-github.ts";

export const editorTools = [
  editRepoTool,
  listReposTool,
  getSessionTool,
  approveChangesTool,
  connectGitHubTool,
];
