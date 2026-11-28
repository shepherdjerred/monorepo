import {
  Banner,
  Button,
  Chip,
  FigureStrip,
  HeaderBar,
  ICONS,
  Section,
  State,
  StatusGlyph,
} from "@shepherdjerred/console-ui";
import { Link } from "react-router";

import { KitTabs } from "./kit-parts.tsx";
import "./kit.css";

const LABELS: readonly (readonly [string, string])[] = [
  ["alertname", "KubePodCrashLooping"],
  ["namespace", "temporal"],
  ["pod", "worker-7c9d5b6f4-x2kqp"],
  ["severity", "critical"],
  ["runbook", "go/runbooks/crashloop"],
];

const EVENTS: readonly (readonly [string, string, string])[] = [
  ["14:02", "Notified", "Email to jerred@ · Discord #alerts"],
  ["13:48", "Escalated", "Warning → critical after 3 restarts"],
  ["11:51", "Opened", "First seen by Alertmanager"],
];

/**
 * `/kit/detail`: the detail-page skeleton the mockup never drew — a back
 * link, verdict, figures, key–value facts beside activity, and an empty
 * section — built from the same pieces as the list page.
 */
export function KitDetailPage(): React.JSX.Element {
  const Back = ICONS.back;
  const Copy = ICONS.copy;
  return (
    <main className="kit-page">
      <HeaderBar
        lead={
          <Link to="/kit">
            <Back aria-hidden="true" />
            Console kit
          </Link>
        }
        title="KubePodCrashLooping"
        tabs={<KitTabs />}
        meta={<StatusGlyph severity="error" label="Critical" />}
        actions={
          <>
            <Button>
              <Copy aria-hidden="true" />
              Copy link
            </Button>
            <Button variant="primary">Acknowledge</Button>
          </>
        }
      />
      <Banner severity="info" label="Silenced">
        A silence by jerred@ ends at 18:00 and covers this alert.
      </Banner>
      <FigureStrip
        label="Alert figures"
        layout="wrap"
        figures={[
          { label: "Firing for", value: "2h 14m" },
          { label: "Restarts", value: 41, severity: "error" },
          { label: "Notifications", value: 3, hint: "last 14:02" },
          { label: "Similar open", value: 0 },
        ]}
      />
      <div className="ui-columns">
        <Section title="Labels" count={LABELS.length}>
          <table className="ui-table">
            <tbody>
              {LABELS.map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{key}</th>
                  <td className="ui-fill">
                    <span className="ui-truncate ui-mono">{value}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Activity" count={EVENTS.length}>
          <table className="ui-table">
            <thead>
              <tr>
                <th scope="col" className="ui-num">
                  Time
                </th>
                <th scope="col">Event</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {EVENTS.map(([time, event, detail]) => (
                <tr key={time}>
                  <td className="ui-num">{time}</td>
                  <th scope="row">{event}</th>
                  <td className="ui-fill">
                    <span className="ui-truncate">{detail}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
      <Section
        title="Related"
        actions={
          <span className="ui-chips">
            <Chip label="Service" value="temporal-worker" href="/kit" />
          </span>
        }
      >
        <State kind="empty">No related alerts in the last 7 days.</State>
      </Section>
    </main>
  );
}
