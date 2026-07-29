export type ScrapedMetrics = {
  text: string;
  /** Wall-clock ms when the scrape was returned. */
  ts: number;
};

type MetricSample = {
  name: string;
  rawLabels: string;
  value: number;
};

const METRIC_LINE_PATTERN = /^([a-z_:][\w:]*)(?:\{([^}]*)\})?\s+(\S+)/i;
const LABEL_PATTERN = /(?:^|,)([a-z_]\w*)="((?:\\.|[^"\\])*)"/gi;

function metricSamples(text: string, name: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const line of text.split("\n")) {
    const match = METRIC_LINE_PATTERN.exec(line);
    if (match?.[1] !== name) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    samples.push({
      name: match[1],
      rawLabels: match[2] ?? "",
      value,
    });
  }
  return samples;
}

/** Build a label-set matcher. Tolerates extra labels and either order. */
function matchesLabels(
  rawLabels: string,
  required: Record<string, string>,
): boolean {
  const actual = new Map<string, string>();
  for (const match of rawLabels.matchAll(LABEL_PATTERN)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) actual.set(name, value);
  }
  for (const [name, value] of Object.entries(required)) {
    if (actual.get(name) !== value) return false;
  }
  return true;
}

function readNumber(
  text: string,
  name: string,
  labels?: Record<string, string>,
): number | null {
  for (const sample of metricSamples(text, name)) {
    if (labels === undefined || matchesLabels(sample.rawLabels, labels)) {
      return sample.value;
    }
  }
  return null;
}

export function counter(
  metrics: ScrapedMetrics,
  name: string,
  labels?: Record<string, string>,
): number {
  return readNumber(metrics.text, name, labels) ?? 0;
}

export function counterSum(metrics: ScrapedMetrics, name: string): number {
  return metricSamples(metrics.text, name).reduce(
    (sum, sample) => sum + sample.value,
    0,
  );
}

export function gauge(
  metrics: ScrapedMetrics,
  name: string,
  labels?: Record<string, string>,
): number | null {
  return readNumber(metrics.text, name, labels);
}

type HistogramRow = { le: number; cum: number };

function histogramRows(
  metrics: ScrapedMetrics,
  name: string,
  labels?: Record<string, string>,
): HistogramRow[] {
  const rows: HistogramRow[] = [];
  for (const sample of metricSamples(metrics.text, `${name}_bucket`)) {
    const rawLabels = sample.rawLabels;
    const leMatch = /(?:^|,)le="([^"]+)"(?:,|$)/.exec(rawLabels);
    const leRaw = leMatch?.[1];
    if (
      leRaw !== undefined &&
      (labels === undefined || matchesLabels(rawLabels, labels))
    ) {
      const le = leRaw === "+Inf" ? Number.POSITIVE_INFINITY : Number(leRaw);
      rows.push({ le, cum: sample.value });
    }
  }
  rows.sort((a, b) => a.le - b.le);
  return rows;
}

function quantileFromRows(rows: readonly HistogramRow[], q: number): number {
  const last = rows.at(-1);
  if (last === undefined || last.cum === 0) return Number.NaN;
  const target = last.cum * q;
  for (const row of rows) if (row.cum >= target) return row.le;
  return Number.POSITIVE_INFINITY;
}

export function histogramQuantile(
  metrics: ScrapedMetrics,
  name: string,
  q: number,
  labels?: Record<string, string>,
): number {
  return quantileFromRows(histogramRows(metrics, name, labels), q);
}

export function histogramDeltaQuantile(input: {
  start: ScrapedMetrics;
  end: ScrapedMetrics;
  name: string;
  q: number;
  labels?: Record<string, string>;
}): number {
  const startRows = new Map(
    histogramRows(input.start, input.name, input.labels).map((row) => [
      row.le,
      row.cum,
    ]),
  );
  const rows = histogramRows(input.end, input.name, input.labels).map((row) => {
    const startCum = startRows.get(row.le) ?? 0;
    if (row.cum < startCum) {
      throw new Error(
        `histogram ${input.name} bucket ${String(row.le)} decreased during measurement`,
      );
    }
    return { le: row.le, cum: row.cum - startCum };
  });
  return quantileFromRows(rows, input.q);
}
