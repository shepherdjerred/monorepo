/**
 * High-fidelity PagerDuty alert-rendering tests.
 *
 * The sibling `helm-template.test.ts` only asserts that the receiver *template
 * source* survives Helm escaping. That proves the string is present, not that it
 * actually produces a clean PagerDuty incident when Alertmanager executes it.
 *
 * These tests close that gap end-to-end:
 *   1. Render the apps chart with `helm template` (same pipeline as ArgoCD), so
 *      the Alertmanager Go templates are in their real post-Helm form.
 *   2. Parse the rendered manifest and pull the live PagerDuty receiver
 *      (`description`, `details.*`, `severity`) out of the Alertmanager config.
 *   3. Execute those exact templates through Go's `text/template` engine (the
 *      engine Alertmanager uses) against realistic alert-group fixtures, via the
 *      committed `test-tools/amrender` helper.
 *   4. Assert on the resulting incident title / custom details — the actual
 *      strings PagerDuty would receive.
 *
 * This catches regressions the grep test cannot: a title that balloons back into
 * a multi-line body, a reintroduced literal "\n", a dropped per-alert detail, a
 * broken severity mapping, or Helm-escaping artifacts (`{{ "{{" }}`).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

const CDK8S_DIR = path.join(import.meta.dir, "..");
const DIST_DIR = path.join(CDK8S_DIR, "dist");
const HELM_DIR = path.join(CDK8S_DIR, "helm");
const AMRENDER_DIR = path.join(CDK8S_DIR, "test-tools", "amrender");

/** PagerDuty caps the incident title (`description`) at 1024 chars. Stay well under. */
const PD_TITLE_MAX = 1024;

const PagerDutyReceiverSchema = z.object({
  description: z.string(),
  severity: z.string(),
  client: z.string().optional(),
  client_url: z.string().optional(),
  details: z.object({
    alertname: z.string(),
    namespace: z.string(),
    severity: z.string(),
    num_firing: z.string(),
    num_resolved: z.string(),
    firing: z.string(),
    resolved: z.string(),
  }),
});
type PagerDutyReceiver = z.infer<typeof PagerDutyReceiverSchema>;

const RecordSchema = z.record(z.string(), z.unknown());
const AmOutputSchema = z.object({
  results: z.array(
    z.object({ id: z.string(), output: z.string(), error: z.string() }),
  ),
});

type AmData = {
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
  groupLabels?: Record<string, string>;
  externalURL?: string;
  alerts?: {
    status: "firing" | "resolved";
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  }[];
};

type AmJob = { id: string; template: string; data: AmData };
type AmResult = { id: string; output: string; error: string };

/** Path to the compiled amrender helper binary (set in beforeAll). */
let amrenderBin = "";

/** Render one Helm chart from `dist/<chart>.k8s.yaml`, mirroring the ArgoCD flow. */
async function helmTemplate(chartName: string): Promise<string> {
  const manifestPath = path.join(DIST_DIR, `${chartName}.k8s.yaml`);
  const tempDir = path.join(
    CDK8S_DIR,
    `.pd-helm-${chartName}-${String(Date.now())}`,
  );
  try {
    const chartYaml = await Bun.file(
      path.join(HELM_DIR, chartName, "Chart.yaml"),
    ).text();
    await Bun.write(
      path.join(tempDir, "Chart.yaml"),
      chartYaml
        .replace("$version", "0.0.0-test")
        .replace("$appVersion", "0.0.0-test"),
    );
    await Bun.write(
      path.join(tempDir, "templates", `${chartName}.k8s.yaml`),
      Bun.file(manifestPath),
    );
    const proc = Bun.spawn(["helm", "template", "test-release", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `helm template ${chartName} failed (${String(exitCode)}): ${stderr}`,
      );
    }
    return stdout;
  } finally {
    Bun.spawnSync(["rm", "-rf", tempDir]);
  }
}

/** Deep-search parsed YAML for the single PagerDuty receiver config. */
function findPagerDutyConfig(rendered: string): PagerDutyReceiver {
  const found: unknown[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const rec = RecordSchema.safeParse(node);
    if (!rec.success) return;
    if (Array.isArray(rec.data["pagerduty_configs"])) {
      found.push(...rec.data["pagerduty_configs"]);
    }
    for (const value of Object.values(rec.data)) visit(value);
  };
  for (const doc of parseAllDocuments(rendered)) {
    visit(doc.toJS());
  }
  if (found.length !== 1) {
    throw new Error(
      `expected exactly 1 pagerduty_configs entry, found ${String(found.length)}`,
    );
  }
  return PagerDutyReceiverSchema.parse(found[0]);
}

/** Compile the amrender helper once (cold `go build`), returning the binary path. */
async function buildAmRender(): Promise<string> {
  const binPath = path.join(CDK8S_DIR, `.amrender-bin-${String(Date.now())}`);
  const proc = Bun.spawn(["go", "build", "-o", binPath, "."], {
    cwd: AMRENDER_DIR,
    stdout: "pipe",
    stderr: "pipe",
    // GOTOOLCHAIN=local: use the installed toolchain rather than fetching one to
    // match go.mod (offline-safe). The module is stdlib-only, so no network.
    env: { ...Bun.env, GOFLAGS: "-mod=mod", GOTOOLCHAIN: "local" },
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `go build amrender failed (${String(exitCode)}): ${stderr}`,
    );
  }
  return binPath;
}

/** Execute a batch of (template, data) jobs through the real Go text/template engine. */
async function amRender(jobs: AmJob[]): Promise<Map<string, AmResult>> {
  const proc = Bun.spawn([amrenderBin], {
    stdin: new TextEncoder().encode(JSON.stringify({ jobs })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`amrender failed (${String(exitCode)}): ${stderr}`);
  }
  const { results } = AmOutputSchema.parse(JSON.parse(stdout));
  return new Map(results.map((r) => [r.id, r]));
}

/** Build an Alertmanager notification-group fixture. */
function group(opts: {
  alertname: string;
  namespace?: string;
  severity?: string;
  summary?: string;
  firing?: { message?: string; description?: string }[];
  resolved?: { message?: string; description?: string }[];
}): AmData {
  const severity = opts.severity ?? "warning";
  const commonLabels: Record<string, string> = {
    alertname: opts.alertname,
    severity,
  };
  if (opts.namespace !== undefined) commonLabels["namespace"] = opts.namespace;
  const commonAnnotations: Record<string, string> = {};
  if (opts.summary !== undefined) commonAnnotations["summary"] = opts.summary;
  const alerts = [
    ...(opts.firing ?? []).map((a) => ({
      status: "firing" as const,
      annotations: { ...a },
    })),
    ...(opts.resolved ?? []).map((a) => ({
      status: "resolved" as const,
      annotations: { ...a },
    })),
  ];
  return {
    commonLabels,
    commonAnnotations,
    groupLabels:
      opts.namespace === undefined
        ? { alertname: opts.alertname }
        : { namespace: opts.namespace, alertname: opts.alertname },
    externalURL: "https://alertmanager.tailnet-1a49.ts.net",
    alerts,
  };
}

describe("PagerDuty alert rendering (high-fidelity, real Go template engine)", () => {
  let pd: PagerDutyReceiver;

  beforeAll(async () => {
    // Render Helm + compile the Go renderer once (both are slow cold operations).
    const [rendered, bin] = await Promise.all([
      helmTemplate("apps"),
      buildAmRender(),
    ]);
    pd = findPagerDutyConfig(rendered);
    amrenderBin = bin;
  }, 120_000);

  afterAll(() => {
    if (amrenderBin) Bun.spawnSync(["rm", "-f", amrenderBin]);
  });

  it("renders a clean single-line title for a multi-PVC Velero group (was a 260-char blob)", async () => {
    const data = group({
      alertname: "VeleroLargePVCMayImpactBackups",
      namespace: "immich",
      summary: "Large PVC may impact Velero backups",
      firing: [
        { message: "PVC immich/immich-data requests 412GiB." },
        { message: "PVC immich/immich-cache requests 190GiB." },
        { message: "PVC immich/immich-thumbs requests 88GiB." },
      ],
    });
    const r = await amRender([
      { id: "title", template: pd.description, data },
      { id: "firing", template: pd.details.firing, data },
      { id: "num_firing", template: pd.details.num_firing, data },
    ]);

    const title = r.get("title")?.output ?? "";
    expect(r.get("title")?.error).toBe("");
    // Clean, single line, well under PagerDuty's truncation cap.
    expect(title).toBe("Large PVC may impact Velero backups [immich] (x3)");
    expect(title).not.toContain("\n");
    expect(title.length).toBeLessThan(PD_TITLE_MAX);
    // No literal backslash-n and no Helm-escape artifacts leaked into the title.
    expect(title).not.toContain(String.raw`\n`);
    expect(title).not.toContain("{{");

    // Full per-alert detail is preserved — in custom details, not the title.
    const firing = r.get("firing")?.output ?? "";
    expect(firing).toContain("- PVC immich/immich-data requests 412GiB.");
    expect(firing).toContain("- PVC immich/immich-cache requests 190GiB.");
    expect(firing).toContain("- PVC immich/immich-thumbs requests 88GiB.");
    expect(r.get("num_firing")?.output).toBe("3");
  });

  it("collapses a 2-host node group into one titled incident with per-host detail", async () => {
    const data = group({
      alertname: "ZfsArcHighEviction",
      summary: "High ZFS ARC eviction rate detected",
      firing: [
        {
          description:
            "ZFS ARC on 100.102.88.88:9100 has high eviction rate: 35172/s",
        },
        {
          description:
            "ZFS ARC on 100.102.88.89:9100 has high eviction rate: 28004/s",
        },
      ],
    });
    const r = await amRender([
      { id: "title", template: pd.description, data },
      { id: "firing", template: pd.details.firing, data },
    ]);
    // No namespace label -> no [namespace] segment, but the count still shows.
    expect(r.get("title")?.output).toBe(
      "High ZFS ARC eviction rate detected (x2)",
    );
    // description-annotation fallback (node rules use `description`, not `message`).
    const firing = r.get("firing")?.output ?? "";
    expect(firing).toContain(
      "- ZFS ARC on 100.102.88.88:9100 has high eviction rate: 35172/s",
    );
    expect(firing).toContain(
      "- ZFS ARC on 100.102.88.89:9100 has high eviction rate: 28004/s",
    );
  });

  it("renders a single-alert incident without a count suffix", async () => {
    const data = group({
      alertname: "KubePodCrashLooping",
      namespace: "redlib",
      summary: "Pod is crash looping.",
      firing: [
        { description: "Pod redlib/redlib-7c9b restarting 5 times / 10 min." },
      ],
    });
    const r = await amRender([{ id: "title", template: pd.description, data }]);
    expect(r.get("title")?.output).toBe("Pod is crash looping. [redlib]");
  });

  it("falls back to the alertname when there is no shared summary annotation", async () => {
    const data = group({
      alertname: "SomeAlertWithoutCommonSummary",
      namespace: "monitoring",
      firing: [{ description: "detail a" }, { description: "detail b" }],
    });
    // No summary => CommonAnnotations.summary empty => alertname used.
    const r = await amRender([{ id: "title", template: pd.description, data }]);
    expect(r.get("title")?.output).toBe(
      "SomeAlertWithoutCommonSummary [monitoring] (x2)",
    );
  });

  it("counts only firing alerts in the title suffix, ignoring resolved ones", async () => {
    // With send_resolved:true, a group can carry resolved alerts alongside firing
    // ones. The title's "(xN)" is a *firing* count, so resolved entries must not
    // inflate it (a fully-resolved group drops the suffix entirely).
    const data = group({
      alertname: "VeleroBackupPartialFailure",
      namespace: "velero",
      summary: "Velero backup experiencing partial failures",
      firing: [
        { message: "backup daily-immich partially failed" },
        { message: "backup daily-plex partially failed" },
      ],
      resolved: [
        { message: "backup daily-postgres recovered" },
        { message: "backup daily-media recovered" },
        { message: "backup daily-vault recovered" },
      ],
    });
    const r = await amRender([{ id: "title", template: pd.description, data }]);
    // 2 firing + 3 resolved -> "(x2)", not "(x5)".
    expect(r.get("title")?.output).toBe(
      "Velero backup experiencing partial failures [velero] (x2)",
    );
  });

  it("maps severity labels to PagerDuty event severities", async () => {
    const cases: { severity: string; expected: string }[] = [
      { severity: "critical", expected: "critical" },
      { severity: "warning", expected: "warning" },
      { severity: "info", expected: "info" },
      { severity: "error", expected: "error" },
      { severity: "weird-unknown-value", expected: "error" }, // default branch
    ];
    const jobs = cases.map((c, i) => ({
      id: `sev-${String(i)}`,
      template: pd.severity,
      data: group({
        alertname: "X",
        severity: c.severity,
        summary: "x",
        firing: [{ description: "d" }],
      }),
    }));
    const r = await amRender(jobs);
    cases.forEach((c, i) => {
      expect(r.get(`sev-${String(i)}`)?.output).toBe(c.expected);
    });
  });

  it("lists resolved alerts separately from firing ones and counts both", async () => {
    const data = group({
      alertname: "VeleroBackupPartialFailure",
      namespace: "velero",
      summary: "Velero backup experiencing partial failures",
      firing: [{ message: "backup daily-immich partially failed" }],
      resolved: [
        { message: "backup daily-plex recovered" },
        { message: "backup daily-postgres recovered" },
      ],
    });
    const r = await amRender([
      { id: "firing", template: pd.details.firing, data },
      { id: "resolved", template: pd.details.resolved, data },
      { id: "num_firing", template: pd.details.num_firing, data },
      { id: "num_resolved", template: pd.details.num_resolved, data },
    ]);
    expect(r.get("firing")?.output).toContain(
      "- backup daily-immich partially failed",
    );
    expect(r.get("firing")?.output).not.toContain("recovered");
    expect(r.get("resolved")?.output).toContain(
      "- backup daily-plex recovered",
    );
    expect(r.get("resolved")?.output).toContain(
      "- backup daily-postgres recovered",
    );
    expect(r.get("num_firing")?.output).toBe("1");
    expect(r.get("num_resolved")?.output).toBe("2");
  });

  it("never leaves a literal backslash-n or Helm artifact in any rendered field", async () => {
    const data = group({
      alertname: "MultiThing",
      namespace: "immich",
      summary: "Something happened",
      firing: [{ message: "a" }, { message: "b" }],
      resolved: [{ message: "c" }],
    });
    const jobs: AmJob[] = [
      { id: "title", template: pd.description, data },
      { id: "firing", template: pd.details.firing, data },
      { id: "resolved", template: pd.details.resolved, data },
      { id: "client_url", template: pd.client_url ?? "", data },
    ];
    const r = await amRender(jobs);
    for (const id of ["title", "firing", "resolved", "client_url"]) {
      const out = r.get(id)?.output ?? "";
      expect(r.get(id)?.error).toBe("");
      expect(out).not.toContain(String.raw`\n`); // literal backslash-n
      expect(out).not.toContain("{{"); // unrendered / escaped template
      expect(out).not.toContain('{{ "{{" }}');
    }
    // client_url resolves to the Alertmanager external URL.
    expect(r.get("client_url")?.output).toBe(
      "https://alertmanager.tailnet-1a49.ts.net",
    );
  });
});
