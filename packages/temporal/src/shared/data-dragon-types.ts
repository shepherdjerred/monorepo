/**
 * The Data Dragon update contract.
 *
 * These types are shared between the update activity, the modules it delegates
 * to (`data-dragon-diff`, `data-dragon-metrics`), and the workflow that drives
 * it. Declaring them in the activity that owns the main entry point made those
 * satellites import it back, which is an import cycle; a contract shared by
 * three modules belongs in the shared layer.
 */

export type DataDragonUpdateMode = "version-check" | "weekly-refresh";

export type DataDragonVersionState = {
  currentVersion: string;
  latestVersion: string;
  updateRequired: boolean;
};

export type DataDragonUpdateInput = DataDragonVersionState & {
  mode: DataDragonUpdateMode;
};

export type DataDragonUpdateResult = DataDragonUpdateInput & {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "success" | "skipped";
  reason:
    | "pr-created"
    | "no-diff"
    | "formatting-only-diff"
    | "image-only-diff"
    | "pr-already-open";
  formattingOnlyFiles?: string[];
  emailSent?: boolean;
  emailMessageId?: string;
  autoMergeConfigured?: boolean;
};
