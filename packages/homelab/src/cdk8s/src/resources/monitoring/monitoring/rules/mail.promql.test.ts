import { expect, test } from "vitest";
import { getMailRuleGroups } from "./mail.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";

function mailRuleExpressions() {
  const rules = getMailRuleGroups().flatMap((group) => group.rules ?? []);
  const byAlert = (name: string) => {
    const value = rules.find((rule) => rule.alert === name)?.expr.value;
    if (typeof value !== "string") {
      throw new TypeError(`Missing ${name} alert expression`);
    }
    return value;
  };
  return {
    rules,
    mailDown: byAlert("MailDown"),
    outboxFailed: byAlert("MailOutboxFailedMessages"),
    queueStuck: byAlert("MailQueueStuck"),
    certExpiring: byAlert("MailSmtpTlsCertExpiringSoon"),
  };
}

test("evaluates MailDown, MailOutboxFailedMessages, MailQueueStuck, and MailSmtpTlsCertExpiringSoon", async () => {
  const { rules, mailDown, outboxFailed, queueStuck, certExpiring } =
    mailRuleExpressions();

  expect(rules.map((rule) => rule.alert)).toEqual([
    "MailDown",
    "MailOutboxFailedMessages",
    "MailQueueStuck",
    "MailSmtpTlsCertExpiringSoon",
  ]);
  for (const rule of rules) {
    expect(rule.annotations?.["summary"]).toMatch(/\S/u);
    expect(rule.annotations?.["description"]).toMatch(/\S/u);
    expect(rule.annotations?.["message"]).toBeUndefined();
  }

  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      {
        interval: "1m",
        input_series: [
          {
            series: 'up{namespace="mail",service="mail"}',
            values: "1+0x10",
          },
          {
            series: 'mail_outbox_messages{service="mail",status="failed"}',
            values: "0+0x10",
          },
          {
            series: 'mail_outbox_messages{service="mail",status="queued"}',
            values: "0+0x10",
          },
          {
            series: 'mail_outbox_messages{service="mail",status="retrying"}',
            values: "0+0x10",
          },
          {
            series: 'mail_outbox_messages{service="mail",status="sent"}',
            values: "42+0x10",
          },
          {
            series:
              'mail_smtp_tls_cert_expiry_timestamp_seconds{service="mail"}',
            values: "2000000+0x10",
          },
        ],
        promql_expr_test: [
          { expr: `count(${mailDown})`, eval_time: "5m", exp_samples: [] },
          { expr: `count(${outboxFailed})`, eval_time: "5m", exp_samples: [] },
          { expr: `count(${queueStuck})`, eval_time: "5m", exp_samples: [] },
          { expr: `count(${certExpiring})`, eval_time: "5m", exp_samples: [] },
        ],
      },
      {
        interval: "1m",
        input_series: [
          {
            series: 'mail_outbox_messages{service="mail",status="failed"}',
            values: "2+0x10",
          },
          {
            series: 'mail_outbox_messages{service="mail",status="retrying"}',
            values: "3+0x10",
          },
          {
            series:
              'mail_smtp_tls_cert_expiry_timestamp_seconds{service="mail"}',
            values: "100000+0x10",
          },
        ],
        promql_expr_test: [
          {
            expr: `count(${mailDown})`,
            eval_time: "5m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
          {
            expr: outboxFailed,
            eval_time: "5m",
            exp_samples: [{ labels: "{}", value: 2 }],
          },
          {
            expr: queueStuck,
            eval_time: "5m",
            exp_samples: [{ labels: "{}", value: 3 }],
          },
          {
            expr: `count(${certExpiring})`,
            eval_time: "5m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
        ],
      },
    ],
  });
});
