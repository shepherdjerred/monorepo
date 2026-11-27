import { RouterContextProvider, type LoaderFunctionArgs } from "react-router";

/** The arguments React Router hands a loader for `url` and its route params. */
export function loaderArgs(
  url: string,
  params: Record<string, string>,
): LoaderFunctionArgs {
  return {
    request: new Request(url),
    url: new URL(url),
    pattern: "/players",
    params,
    context: new RouterContextProvider(),
  };
}

/** The query keys a spied `queryClient.query` was asked to warm, as JSON. */
export function prefetchedKeys(spy: {
  mock: { calls: unknown[][] };
}): string[] {
  return spy.mock.calls.map((call) => JSON.stringify(call[0]));
}
