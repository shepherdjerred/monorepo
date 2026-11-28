/** Hand-written Prometheus exposition, like Tracker's `/metrics`. */
export type Metrics = ReturnType<typeof createMetrics>;

type Labels = Record<string, string>;

function render(labels: Labels): string {
  const entries = Object.entries(labels);
  return entries.length === 0
    ? ""
    : `{${entries.map(([key, value]) => `${key}="${value.replaceAll('"', "'")}"`).join(",")}}`;
}

class CounterFamily {
  readonly #values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels = {}, by = 1) {
    const key = render(labels);
    const entry = this.#values.get(key) ?? { labels, value: 0 };
    entry.value += by;
    this.#values.set(key, entry);
  }
  lines(): string[] {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      ...(this.#values.size === 0 ? [`${this.name} 0`] : []),
      ...[...this.#values.values()].map(
        ({ labels, value }) => `${this.name}${render(labels)} ${String(value)}`,
      ),
    ];
  }
}

export function gaugeLines(
  name: string,
  help: string,
  samples: { labels?: Labels; value: number }[],
): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    ...samples.map(
      ({ labels = {}, value }) => `${name}${render(labels)} ${String(value)}`,
    ),
  ];
}

/**
 * Counters the server increments. Labels are bounded sets (route names,
 * status codes, reasons); a path, token or actor key is never a label.
 */
export function createMetrics() {
  const requests = new CounterFamily(
    "artifacts_requests_total",
    "Requests by host class, route and status",
  );
  const csrf = new CounterFamily(
    "artifacts_csrf_rejections_total",
    "Requests rejected by the app host's CSRF or login gate",
  );
  const uploadBytes = new CounterFamily(
    "artifacts_upload_bytes_total",
    "Blob bytes accepted by uploads",
  );
  const s3Errors = new CounterFamily(
    "artifacts_s3_errors_total",
    "Object store failures by operation",
  );
  return {
    requests: (labels: { host: string; route: string; status: number }) => {
      requests.inc({ ...labels, status: String(labels.status) });
    },
    csrfRejection: (reason: string) => {
      csrf.inc({ reason });
    },
    uploadBytes: (bytes: number) => {
      uploadBytes.inc({}, bytes);
    },
    s3Error: (op: string) => {
      s3Errors.inc({ op });
    },
    lines: () => [
      ...requests.lines(),
      ...csrf.lines(),
      ...uploadBytes.lines(),
      ...s3Errors.lines(),
    ],
  };
}
