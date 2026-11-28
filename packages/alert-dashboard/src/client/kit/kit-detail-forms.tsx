import {
  BackLink,
  CodeBlock,
  CopyButton,
  DescriptionList,
  Disclosure,
  Duration,
  EmailPreview,
  ExactTime,
  Kbd,
  ListToggle,
  Pager,
  RelativeTime,
  SavedStatus,
  Section,
  Skeleton,
  StatusDot,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  useCapped,
} from "@shepherdjerred/console-ui";

import { KitForm } from "./kit-form.tsx";

/** Fixed moments, so the gallery reads the same on every visit. */
const FIRED_AT = "2026-11-26T19:48:09Z";
const NOW = "2026-11-26T22:02:09Z";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const RULE_YAML = `alert: KubePodCrashLooping
expr: |
  max_over_time(kube_pod_container_status_waiting_reason{
    reason="CrashLoopBackOff"}[5m]) >= 1
for: 15m
labels:
  severity: critical
  team: platform
annotations:
  summary: Pod {{ $labels.pod }} is crash looping
  runbook: https://runbooks.example/crashloop`;

const LABELS = Array.from({ length: 9 }, (_, index) => ({
  key: `label_${String(index + 1)}`,
  value: `value-${String(index + 1)}`,
}));

const EMAIL_HTML = `<!doctype html><html><body style="font-family:sans-serif;margin:16px">
<h2 style="margin:0 0 8px">Weekly digest</h2>
<p style="margin:0 0 8px">4 alerts fired, 3 resolved. Longest outage: 2h 14m.</p>
<p style="margin:0;color:#5a5c53">Sent Nov 26, 14:02 PT</p>
</body></html>`;

const EMAIL_TEXT = `Weekly digest

4 alerts fired, 3 resolved. Longest outage: 2h 14m.
Sent Nov 26, 14:02 PT`;

function DetailPage(): React.JSX.Element {
  const labels = useCapped(LABELS, 5);
  return (
    <>
      <div className="kit-row">
        <BackLink href="/kit" label="Alerts" />
        <strong>KubePodCrashLooping</strong>
        <span className="ui-muted">
          Fired <RelativeTime value={FIRED_AT} now={NOW} />
        </span>
        <CopyButton text="9f2c41ab77d0" label="Copy fingerprint" />
      </div>
      <div className="ui-columns">
        <Section title="Summary" headingLevel={3}>
          <DescriptionList
            label="Alert summary"
            items={[
              { label: "Status", value: "Firing", severity: "error" },
              { label: "Service", value: "temporal-worker" },
              { label: "Fingerprint", value: "9f2c41ab77d0", mono: true },
              {
                label: "Firing for",
                value: <Duration start={FIRED_AT} end={NOW} />,
              },
              {
                label: "Started",
                value: <ExactTime value={FIRED_AT} precision="second" />,
              },
              { label: "Restarts", value: formatCount(1284), mono: true },
              {
                label: "Summary",
                value: "Pod worker-7c9 is crash looping in namespace temporal.",
                wide: true,
              },
            ]}
          />
          <CodeBlock
            label="Alert rule"
            code={RULE_YAML}
            lineNumbers
            activeLine={4}
          />
          <Disclosure title="Labels" count={LABELS.length} defaultOpen>
            <ul id="kit-labels" className="kit-labels">
              {labels.shown.map((label) => (
                <li key={label.key} className="ui-mono">
                  {label.key}={label.value}
                </li>
              ))}
            </ul>
            <ListToggle list={labels} controls="kit-labels" noun="labels" />
          </Disclosure>
          <Pager
            label="Alert history pages"
            olderHref="/kit/detail?before=41"
          />
        </Section>
        <Section title="Details" headingLevel={3}>
          <DescriptionList
            layout="rail"
            label="Alert details"
            items={[
              { label: "Cluster", value: "torvalds" },
              { label: "Namespace", value: "temporal", mono: true },
              {
                label: "Memory",
                value: formatBytes(1.5 * 1024 ** 3),
                mono: true,
              },
              {
                label: "Budget used",
                value: formatPercent(0.972, 1),
                mono: true,
              },
              {
                label: "Longest outage",
                value: formatDuration(2 * HOUR + 14 * MINUTE),
                mono: true,
              },
            ]}
          />
        </Section>
      </div>
    </>
  );
}

function Feedback(): React.JSX.Element {
  return (
    <div className="ui-columns">
      <Section title="Time" headingLevel={3}>
        <div className="kit-row">
          <RelativeTime value="2026-11-26T22:01:50Z" now={NOW} />
          <RelativeTime value="2026-11-26T21:57:09Z" now={NOW} />
          <RelativeTime value="2026-11-26T19:02:09Z" now={NOW} />
          <RelativeTime value="2026-11-20T22:02:09Z" now={NOW} />
          <RelativeTime value="2026-08-26T22:02:09Z" now={NOW} />
          <RelativeTime value="2025-06-01T22:02:09Z" now={NOW} />
        </div>
        <div className="kit-row">
          <ExactTime value={NOW} />
          <ExactTime value={NOW} precision="second" />
          <Duration ms={2 * HOUR + 14 * MINUTE} />
        </div>
      </Section>
      <Section title="Status and keys" headingLevel={3}>
        <div className="kit-row">
          <StatusDot state="live" />
          <StatusDot state="connecting" />
          <StatusDot state="reconnecting" />
          <StatusDot state="offline" />
        </div>
        <div className="kit-row">
          <span>
            Press <Kbd>/</Kbd> to search
          </span>
          <span>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd> opens the palette
          </span>
          <SavedStatus saved />
        </div>
      </Section>
    </div>
  );
}

/** The gallery's "Detail and forms" section: every CU2 piece, in context. */
export function KitDetailForms(): React.JSX.Element {
  return (
    <>
      <Section title="Detail page">
        <DetailPage />
      </Section>
      <Section title="Form">
        <KitForm />
      </Section>
      <Feedback />
      <div className="ui-columns">
        <Section title="Loading bones" headingLevel={3}>
          <Skeleton kind="line" lines={3} />
          <Skeleton kind="rows" rows={3} columns={4} />
        </Section>
        <Section title="Email preview" headingLevel={3}>
          <EmailPreview html={EMAIL_HTML} text={EMAIL_TEXT} />
        </Section>
      </div>
    </>
  );
}
