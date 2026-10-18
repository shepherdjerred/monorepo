export function createDeliveryArgoReader(input: {
  server: string;
  token: string;
  signal?: AbortSignal;
}) {
  return async (path: string): Promise<unknown> => {
    const response = await fetch(
      new URL(
        `api/v1/applications/${path}`,
        `${input.server.replace(/\/$/u, "")}/`,
      ),
      {
        headers: { authorization: `Bearer ${input.token}` },
        signal:
          input.signal === undefined
            ? AbortSignal.timeout(30_000)
            : AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
      },
    );
    if (!response.ok)
      throw new Error(
        `Argo recovery inspection returned HTTP ${String(response.status)}`,
      );
    return await response.json();
  };
}
