import {
  assertSelectionContract,
  mainSteps,
  renderFallbackSteps,
  renderSteps,
  selectedKeys,
  validateRenderedSteps,
} from "./select-main-pipeline.ts";

type PipelineStep = Record<string, unknown>;
type PipelineDocument = {
  readonly agents: unknown;
  readonly env: unknown;
  readonly steps: readonly PipelineStep[];
};

export type SelectionDependencies = {
  readonly prepareBase: () => Promise<string>;
  readonly writeChangedFiles: (base: string) => Promise<string>;
  readonly selectLanes: (base: string) => Promise<Map<string, boolean>>;
  readonly recordSelectedSteps: (
    selected: ReadonlySet<string>,
  ) => Promise<void>;
  readonly uploadPipeline: (
    document: PipelineDocument,
    steps: readonly PipelineStep[],
    changedFilesPath: string | undefined,
  ) => Promise<void>;
  readonly annotateFallback: (reason: string) => Promise<void>;
  readonly deleteChangedFiles: (path: string) => Promise<void>;
};

export async function runSelection(
  document: PipelineDocument,
  dependencies: SelectionDependencies,
): Promise<number> {
  let steps: Map<string, PipelineStep> | undefined;
  let changedFilesPath: string | undefined;
  let uploaded = false;
  try {
    steps = mainSteps(document);
    assertSelectionContract(steps);
    const base = await dependencies.prepareBase();
    changedFilesPath = await dependencies.writeChangedFiles(base);
    const decisions = await dependencies.selectLanes(base);
    const selected = selectedKeys(steps, decisions);
    const rendered = renderSteps(steps, selected);
    validateRenderedSteps(rendered);
    await dependencies.recordSelectedSteps(selected);
    await dependencies.uploadPipeline(document, rendered, changedFilesPath);
    uploaded = true;
    console.log(`Uploaded ${selected.size.toString()} selected main CI steps`);
    return 0;
  } catch (error) {
    if (uploaded) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`WARN: ${reason}; falling back to the complete main graph`);
    const rendered = renderFallbackSteps(document, steps, changedFilesPath);
    validateRenderedSteps(rendered);
    try {
      await dependencies.recordSelectedSteps(new Set());
    } catch (clearError) {
      const detail =
        clearError instanceof Error ? clearError.message : String(clearError);
      console.error(`WARN: could not clear the recorded selection: ${detail}`);
    }
    await dependencies.uploadPipeline(document, rendered, changedFilesPath);
    await dependencies.annotateFallback(reason);
    return 0;
  } finally {
    if (changedFilesPath !== undefined) {
      await dependencies.deleteChangedFiles(changedFilesPath);
    }
  }
}
