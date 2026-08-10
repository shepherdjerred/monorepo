---
id: plan-2026-08-09-posthog-analytics-cutover
type: plan
status: complete
board: false
---

# PostHog analytics cutover

## Goal

Replace every active Matomo and Plausible integration with one existing
PostHog Cloud US project, restore the standard site and ArgoCD release graph,
and remove both retired services from repository configuration and live
cluster state.

## Decisions

- Track `sjer.red`, `resume.sjer.red`, `webring.sjer.red`,
  `better-skill-capped.com`, `mariokart.sjer.red`, `pokebot.sjer.red`,
  `scout-for-lol.com`, and `beta.scout-for-lol.com` in one PostHog project.
- Enable pageviews and autocapture on every site. Enable session replay only
  on the two Scout hosts, using PostHog's standard masking behavior.
- Use cookieless collection, respect DNT, disable person profiles and
  identification, suppress IP collection in project settings, and remove
  query strings, fragments, and dynamic route identifiers from analytics
  URLs.
- Commit the public PostHog project token in the language-neutral analytics
  registry. Do not add a personal API key or a CI/runtime secret.
- Do not deploy PostHog into Kubernetes. PostHog Cloud adds no namespace,
  database, PVC, DNS record, backup, or deployment readiness dependency.
- Do not import Matomo or Plausible history. Purge their retained live volumes
  only after the PostHog production smoke test; shared Velero backups expire
  under their existing retention policy.
- Preserve factual vendor references in archived plans and changelogs while
  removing every active runtime, configuration, CI, and operator-doc reference.

## Implementation

1. Replace the analytics registry/schema and static trackers with PostHog;
   preserve Scout's closed event union, bounded properties, normalized routes,
   conversion tracking, and unload-safe outbound navigation.
2. Remove Matomo-specific Buildkite lanes, readiness gates, Argo deferral, and
   tracker dependencies. Restore generic site releases, unconditional Argo
   health checks, and automatic sync for the Discord game applications. This
   directly supersedes the useful cleanup proposed in PR #2065; leave that PR
   open for its author/operator to close.
3. Remove Matomo and Plausible Argo applications, charts, databases, backup
   selections, network-policy exceptions, DNS, CSP entries, and secret
   references. Render the exact root revision and verify only those two
   analytics applications become prune candidates.
4. Replace the Matomo operator page with PostHog Cloud setup and verification,
   update the active Scout adoption plan, and archive the superseded Scout
   Matomo instrumentation plan.
5. After deployment, verify PostHog events from all eight hosts and replay only
   from Scout. Re-resolve the former PVC ownership of these retained volume
   identities before deletion:
   - `pvc-1571ab39-a046-4eab-b679-e83a3e0399be`
   - `pvc-e854ac9b-3988-4237-9855-835a36b30fd4`
   - `pvc-8f85339a-1a6e-4ac3-8307-721be17f5a42`
   - `pvc-fb500094-6ff0-45c8-9ac5-3a193e85ddf4`
6. Delete only those four OpenEBS `ZFSVolume` resources, verify the exact
   datasets disappeared without recursive `zfs destroy`, and then delete their
   Released PV records.
7. After confirming all cluster consumers are gone, delete 1Password items
   `5lstnmhcewdtrrs7dtutqhq2xu` and `grbpijpjbt2ocw3vmrue2yoelq`.
   Refresh the hashed vault snapshot in a follow-up PR, then archive this plan.

## Acceptance boundaries

Focused tests, Buildkite, and synthesized GitOps resources establish source and
release correctness; they do not prove the production cutover. Live acceptance
requires PostHog events from every hostname, Scout replay, no browser traffic or
DNS for the retired vendors, successful Argo pruning, and explicit proof that
the four old datasets and obsolete vault items are gone.

## Completion evidence

- PR #2084 shipped the source, CI, documentation, DNS, and GitOps cutover; PR
  #2089 promoted the immutable Scout `2.0.0-8810` backend/site release to
  production. Main Buildkite build #8819 passed every selected lane, including
  Argo reconciliation and Scout production reconcile.
- Browser acceptance received successful PostHog ingestion responses from all
  eight hostnames with no Matomo or Plausible requests. Only the two Scout
  hosts loaded the recorder; production Scout also completed a successful
  replay upload. PostHog's served project configuration reports IP collection
  disabled.
- Argo pruned the Matomo and Plausible applications and namespaces, their
  TunnelBindings and 1Password custom resources disappeared, and neither
  retired DNS name resolves.
- The four retained PVs were re-resolved to their exact former claims and were
  `Released`. Only their matching OpenEBS `ZFSVolume` resources were deleted;
  the controller removed all four exact datasets before their PV records were
  deleted. No recursive ZFS command was used.
- The two exact retired 1Password items were deleted after their consumers were
  gone. The committed hashed vault snapshot was then refreshed from live state;
  shared Velero backups remain untouched and will expire normally.
