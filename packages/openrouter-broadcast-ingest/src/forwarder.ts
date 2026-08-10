export type TempoForwarder = {
  forward: (payload: string) => Promise<void>;
};

export function createTempoForwarder(url: string): TempoForwarder {
  return {
    async forward(payload) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Tempo OTLP forwarding failed (${String(response.status)}): ${body}`,
        );
      }
    },
  };
}
