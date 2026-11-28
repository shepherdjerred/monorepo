import { describe, expect, test } from "vitest";
import {
  buildAlertOpeningDocument,
  buildAlertTruncationDocument,
} from "./alert-context.ts";
import {
  cleanAlertSummary,
  extractAlertDetails,
  splitAlertExplanation,
} from "./alert-humanize.ts";
import {
  MailboxAddressSchema,
  OPS_MAILBOXES,
  extractEmailAddress,
  extractSenderDisplayName,
  reportMailboxForType,
} from "./mailbox.ts";
import {
  escapeHtml,
  formatPacificShortTime,
  formatPacificTimestamp,
  safeHttpUrl,
} from "./primitives.ts";
import { renderEmailHtml } from "./render-html.ts";
import { renderEmailText } from "./render-text.ts";

describe("mailbox validation and semantic routing", () => {
  test("accepts bare addresses and clean display-name mailboxes", () => {
    expect(MailboxAddressSchema.parse("alerts@sjer.red")).toBe(
      "alerts@sjer.red",
    );
    expect(MailboxAddressSchema.parse("Hub Alerts <alerts@sjer.red>")).toBe(
      "Hub Alerts <alerts@sjer.red>",
    );
    expect(extractEmailAddress("Hub Alerts <alerts@sjer.red>")).toBe(
      "alerts@sjer.red",
    );
    expect(extractSenderDisplayName("Hub Alerts <alerts@sjer.red>")).toBe(
      "Hub Alerts",
    );
  });

  test("rejects malformed or header-injection mailbox strings", () => {
    expect(MailboxAddressSchema.safeParse("not-an-email").success).toBe(false);
    expect(
      MailboxAddressSchema.safeParse("Bad\nHeader <alerts@sjer.red>").success,
    ).toBe(false);
    expect(
      MailboxAddressSchema.safeParse('Quoted "Name" <alerts@sjer.red>').success,
    ).toBe(false);
  });

  test("maps report families to semantic @sjer.red mailboxes", () => {
    expect(reportMailboxForType("dependency-summary")).toEqual(
      OPS_MAILBOXES.reports.dependencies,
    );
    expect(reportMailboxForType("homelab-audit")).toEqual(
      OPS_MAILBOXES.reports.ops,
    );
    expect(reportMailboxForType("tasknotes-canary")).toEqual(
      OPS_MAILBOXES.reports.ops,
    );
    for (const scoutType of [
      "scout-data-dragon",
      "scout-lane-priors",
      "scout-queue-windows",
      "scout-season-refresh",
    ]) {
      expect(reportMailboxForType(scoutType)).toEqual(
        OPS_MAILBOXES.reports.scout,
      );
    }
    for (const generalType of [
      "main-vuln-scan",
      "link-rot-scan",
      "storm-promotion",
      "agent-task",
      "unknown-future-report",
    ]) {
      expect(reportMailboxForType(generalType)).toEqual(
        OPS_MAILBOXES.reports.general,
      );
    }
  });
});

describe("alert comprehension and rendering", () => {
  test("cleans headlines, humanizes upstream rules, splits next steps, and strips scrape labels", () => {
    expect(
      cleanAlertSummary("[Argo CD] No reported applications", "ArgoAppMissing"),
    ).toBe("No reported applications");

    expect(
      cleanAlertSummary(
        "Golink Tailscale sign-in failed on boot",
        "GolinkAuthkeyIgnored",
        "Golink",
      ),
    ).toBe("Tailscale sign-in failed on boot");

    expect(
      cleanAlertSummary(
        "Pod foo-78fd944888-jr7bm crash looping",
        "KubePodCrashLooping",
      ),
    ).toBe("Pod is restarting repeatedly");

    expect(
      splitAlertExplanation(
        {
          description:
            "In-flight chat runs are paused because worker code does not match saved history. Pause the rollout and test replay locally.",
        },
        "Workflow stuck",
      ),
    ).toEqual({
      impact:
        "In-flight chat runs are paused because worker code does not match saved history.",
      nextStep: "Pause the rollout and test replay locally.",
    });

    const details = extractAlertDetails({
      alertname: "TemporalWorkflowNondeterministic",
      namespace: "temporal",
      openedAtIso: "2026-11-20T06:28:28.395Z",
      labels: {
        alertname: "TemporalWorkflowNondeterministic",
        severity: "critical",
        instance: "10.244.0.140:9464",
        job: "temporal-metrics-service",
        endpoint: "metrics",
        prometheus: "prometheus/k8s",
        workflow_type: "photonConversationWorkflow",
        task_queue: "monorepo-workflows",
        pod: "temporal-worker-r27hl",
      },
    });
    expect(details.map((row) => row.label)).toEqual([
      "Workflow",
      "Queue",
      "Pod",
      "Started",
      "Alert rule",
    ]);
  });

  test("groups repeated occurrences under specific app names and renders action-first HTML & text", () => {
    const { subject, document } = buildAlertOpeningDocument({
      alerts: [
        {
          id: "alert_1",
          alertname: "StreambotEncoderProducerAhead",
          namespace: "media",
          severity: "warning",
          summary: "Stream video is running ahead of audio",
          openedAtIso: "2026-11-20T04:49:58.507Z",
          labels: {
            alertname: "StreambotEncoderProducerAhead",
            app: "streambot",
            namespace: "media",
            pod: "media-streambot-1",
            instance: "10.244.0.57:9466",
            severity: "warning",
          },
          annotations: {
            message:
              "Discord viewers may notice brief ~1s video freezes. Check the stream readrate setting on the Streambot deployment.",
          },
        },
        {
          id: "alert_2",
          alertname: "StreambotEncoderProducerAhead",
          namespace: "media",
          severity: "warning",
          summary: "Stream video is running ahead of audio",
          openedAtIso: "2026-11-20T04:50:10.000Z",
          labels: {
            alertname: "StreambotEncoderProducerAhead",
            app: "streambot",
            namespace: "media",
            pod: "media-streambot-2",
            instance: "10.244.0.58:9466",
            severity: "warning",
          },
          annotations: {
            message:
              "Discord viewers may notice brief ~1s video freezes. Check the stream readrate setting on the Streambot deployment.",
          },
        },
      ],
    });

    expect(subject).toBe(
      "Warning: Streambot stream video is running ahead of audio (2 pods)",
    );

    const html = renderEmailHtml(document);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('meta name="color-scheme" content="light dark"');
    expect(html).toContain("Next step:");
    expect(html).toContain("Technical details");
    expect(html).toContain("media-streambot-1, media-streambot-2");
    expect(html).not.toContain("10.244.0.57:9466");
    expect(html).toContain("Grafana");
    // Sentence-case headings: no uppercase transform or letter-spacing.
    expect(html).not.toContain("text-transform");
    expect(html).not.toContain("letter-spacing");

    // Primary CTA appears above Technical details for fast mobile triage.
    expect(html.indexOf("Open Hub Alerts")).toBeLessThan(
      html.indexOf("Technical details"),
    );

    const text = renderEmailText(document);
    expect(text).toContain(
      "Instances (2): media-streambot-1, media-streambot-2",
    );
    expect(text).toContain("Next step: Check the stream readrate setting");
  });

  test("escapes untrusted HTML and drops non-http URLs", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("https://hub.tailnet-1a49.ts.net/alerts")).toBe(
      "https://hub.tailnet-1a49.ts.net/alerts",
    );

    const trunc = buildAlertTruncationDocument(7);
    const truncHtml = renderEmailHtml(trunc.document);
    expect(truncHtml).toContain("7");
    expect(truncHtml).not.toContain("}}");
    expect(formatPacificTimestamp("2026-08-10T16:01:00.000Z")).toBe(
      "Aug 10, 9:01 AM PDT",
    );
    expect(formatPacificShortTime("2026-11-21T03:45:00.000Z")).toBe(
      "Nov 20 19:45",
    );
  });
});
