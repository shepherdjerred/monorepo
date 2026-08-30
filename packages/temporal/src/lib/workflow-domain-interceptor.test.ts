import { describe, expect, test, vi } from "vitest";

const setAttribute = vi.fn();
const getActiveSpan = vi.fn(
  (): { setAttribute: typeof setAttribute } | undefined => ({ setAttribute }),
);
const workflowInfo = vi.fn();

vi.mock("@opentelemetry/api", () => ({
  trace: { getActiveSpan },
}));
vi.mock("@temporalio/workflow", () => ({ workflowInfo }));

const { WorkflowDomainTaggingInterceptor, interceptors } =
  await import("./workflow-domain-interceptor.ts");

describe("WorkflowDomainTaggingInterceptor", () => {
  test("tags the active span with the execution domain derived from workflowType", async () => {
    workflowInfo.mockReturnValue({
      workflowType: "goodMorningWakeUp",
      taskQueue: "monorepo-workflows",
    });
    const interceptor = new WorkflowDomainTaggingInterceptor();
    const next = vi.fn(async () => "workflow result");

    const result = await interceptor.execute({ headers: {}, args: [] }, next);

    expect(result).toBe("workflow result");
    expect(setAttribute).toHaveBeenCalledWith("temporal.domain", "home");
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("falls back to the taskQueue mapping for an unlisted workflowType", async () => {
    workflowInfo.mockReturnValue({
      workflowType: "someFutureWorkflow",
      taskQueue: "home",
    });
    const interceptor = new WorkflowDomainTaggingInterceptor();

    await interceptor.execute(
      { headers: {}, args: [] },
      vi.fn((): Promise<unknown> => Promise.resolve()),
    );

    expect(setAttribute).toHaveBeenCalledWith("temporal.domain", "home");
  });

  test("does not throw when no span is active", async () => {
    getActiveSpan.mockReturnValueOnce(undefined);
    workflowInfo.mockReturnValue({
      workflowType: "goodMorningWakeUp",
      taskQueue: "monorepo-workflows",
    });
    const interceptor = new WorkflowDomainTaggingInterceptor();

    await expect(
      interceptor.execute(
        { headers: {}, args: [] },
        vi.fn((): Promise<unknown> => Promise.resolve()),
      ),
    ).resolves.toBeUndefined();
  });

  test("exports a WorkflowInterceptorsFactory that registers the interceptor inbound", () => {
    const result = interceptors();
    expect(result.inbound).toHaveLength(1);
    expect(result.inbound?.[0]).toBeInstanceOf(
      WorkflowDomainTaggingInterceptor,
    );
  });
});
