/**
 * The slice of a Temporal client the failure watcher needs.
 *
 * Declared apart from the watcher because the detail extractor it delegates to
 * takes this type as a parameter, and the watcher imports that extractor back.
 */

export type WorkflowVisibilityClient = {
  workflow: {
    list: (options: { query: string; pageSize?: number }) => AsyncIterable<{
      workflowId: string;
      runId: string;
      type: string;
      taskQueue: string;
      startTime: Date;
      closeTime?: Date;
      status: { name: string };
    }>;
    getHandle: (
      workflowId: string,
      runId: string,
    ) => {
      result: () => Promise<unknown>;
      fetchHistory: () => Promise<unknown>;
    };
  };
};
