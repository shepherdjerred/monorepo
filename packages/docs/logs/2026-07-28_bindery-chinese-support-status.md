---
id: log-2026-07-28-bindery-chinese-support-status
type: log
status: complete
board: false
---

# Bindery Chinese Support Status

## Question

Determine whether the Bindery work for adding Chinese authors and books is
implemented, merged, deployed, and verified.

## Findings

- PR #1643 merged the in-monorepo Bindery patch and image-build path. The patch
  creates deterministic `gb:author:` synthetic authors for name-only Google
  Books results and includes positive and negative Go regression tests.
- Main CI recorded a real first-party image pin:
  `ghcr.io/shepherdjerred/bindery:2.0.0-6690@sha256:5a6c71a348d4a49ebd30ef3d00f6c8fb075f9e81f622d4f187e98fb7cf29c539`.
- The GHCR package is anonymously pullable. After the user made it public, an
  unauthenticated token request and a manifest request for the exact pinned
  digest both returned HTTP 200 on 2026-07-28.
- Main still configures the media Deployment with
  `docker.io/vavallee/bindery:v1.26.2`; PR #1759 switches the GitOps source to
  the patched first-party image.
- At the user's request, the live `media-bindery` Deployment was directly
  switched to the pinned first-party digest for testing. The rollout completed
  with one ready replica, zero restarts, version `6690`, and an external health
  response of HTTP 200 with `{"status":"ok","version":"6690"}`.
- PR #1759 contains the durable deployment switch and passes all 34 affected
  verification tasks. The planned live replay remains unchecked: Chinese Google
  Books add returning HTTP 201, Wanted-to-ingest pipeline completion, and UI
  confirmation that the former 422 is gone.

## Conclusion

The implementation, image publication, public-access gate, temporary live
deployment, and durable GitOps PR are done. PR #1759 still needs to merge, and
the Chinese author/book flow is not end-to-end verified.

## Session Log — 2026-07-28

### Done

- Verified PR #1643 and follow-up image-smoke fixes are merged.
- Verified the first-party image digest is recorded in `versions.ts`.
- Verified anonymous GHCR token and pinned-manifest access both return HTTP 200.
- Directly switched the live `media-bindery` Deployment to the pinned patched
  image for testing and verified rollout, pod readiness, zero restarts, image
  digest, startup logs, and the external health endpoint.
- Opened PR #1759 from the `feature/bindery-patched-deploy` git-spice stack.
- Passed `bun run verify -- --affected`: 34 successful tasks.
- Independently synthesized `dist/media.k8s.yaml` and verified the Bindery
  Deployment renders the exact public GHCR tag and digest.

### Remaining

- Merge PR #1759.
- After merge, replay the Chinese Google Books add through the API and UI, then
  verify the Wanted → ShelfBridge → qBittorrent → ingest → CWA path.

### Caveats

- ArgoCD automation has no self-heal flag, so the live override currently
  persists, but a later media sync or Git revision can restore the upstream
  image until PR #1759 merges.
- Kubernetes emitted restricted-policy warnings for the existing
  `init-books-dirs` security context; enforcement did not block the rollout.
- Bindery logs warn that `/books` is read-only. That matches the External-mode
  design in which CWA owns library writes; Bindery still started healthy.
