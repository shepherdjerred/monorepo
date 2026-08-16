# PostHog analytics and data governance

Start from a product decision, then design the smallest event model that can
answer it. Capture source configuration, event delivery, and stored/queryable
events are different kinds of evidence.

## Event and identity model

- Prefer named, business-meaningful events and stable properties over a large
  ungoverned autocapture stream.
- Define event ownership, property semantics, and a deprecation path before
  making a metric durable.
- Establish identity resolution and group analytics deliberately. Anonymous to
  identified transitions and account/group membership can materially change
  the interpretation of funnels and retention.
- Query the project schema before analysis; do not carry event names or
  property assumptions between projects.

## Evidence ladder for ingestion

1. Repository source validation proves the tracker source is wired as expected.
2. An HTTP capture response proves the endpoint accepted a request.
3. Live Events or a schema-backed query proves the event was stored and is
   available to analysis.

When diagnosing missing analytics, report which rung passed and which did not.
Do not report a 200 capture response as end-to-end ingestion proof.

## Privacy and replay

Collect only data justified by the product question. Configure masking,
retention, consent, proxying, and any network/body capture before increasing
replay or observability scope. Replay is a diagnostic follow-up to a defined
cohort, funnel drop-off, error, or support report—not a browsing surface for
unbounded user data.

## Analysis discipline

Specify population, time range, event/property definition, cohort/group scope,
and exclusion rules. Inspect funnel ordering and conversion windows, retention
method, path cleaning, and experiment exposure before interpreting a trend.
Maintain a small set of owned dashboards tied to recurring decisions; a
dashboard without an owner, question, or review rhythm is not a source of
truth.

The practitioner sources in entries 46–50 of [the source ledger](sources.md)
support this question-first, taxonomy-first approach; official documentation
remains authoritative for PostHog behavior and configuration.
