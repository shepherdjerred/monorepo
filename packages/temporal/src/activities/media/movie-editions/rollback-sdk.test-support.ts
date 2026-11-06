import { MockActivityEnvironment } from "@temporalio/testing";

/** Preserve the Activity function's actual result generic through the SDK's
 * three-parameter run signature. Execution still uses the real SDK environment. */
export function movieRollbackSdkEnvironment(
  info: ConstructorParameters<typeof MockActivityEnvironment>[0],
) {
  const environment = new MockActivityEnvironment(info);
  return {
    run: <Args extends unknown[], Result>(
      activity: (...args: Args) => Promise<Result>,
      ...args: Args
    ) => environment.run<Args, Result, typeof activity>(activity, ...args),
  };
}
