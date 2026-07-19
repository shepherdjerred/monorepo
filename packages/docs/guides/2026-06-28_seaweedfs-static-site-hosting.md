---
id: guide-2026-06-28-seaweedfs-static-site-hosting
type: guide
status: complete
board: false
---

# SeaweedFS Static-Site Hosting

How `*.sjer.red` web apps are served, and the recurring SeaweedFS gotchas behind broken deploys and flaky asset loads.

## Hosting Topology — S3 bucket vs container

The monorepo serves web apps two different ways. Know which before proposing a deploy or upload:

- **SeaweedFS S3 static buckets** (served via Caddy s3proxy). Defined in `packages/homelab/src/tofu/seaweedfs/buckets.tf`: `better-skill-capped`, `clauderon`, `resume`, `scout-frontend(-beta)`, `sjer-red`, `ts-mc`, `webring`, `cook`, `scout-beta`, `scout-prod`. Content is synced into buckets **by CI** (`deploySitesGroup` in `scripts/ci/src/steps/sites.ts`, gated behind `tofu-seaweedfs`) — not by manual `aws s3 cp`. `files.sjer.red` / `storage.ts-mc.net` are Cloudflare **R2** (separate).
- **K8s container Deployments** (cdk8s → ArgoCD). e.g. `discord-plays-mario-kart` and `discord-plays-pokemon`: the React SPA is the controller UI, **baked into the backend image** and served by the backend pod (which runs the emulator + Discord Go-Live stream). There is **no mario-kart/pokemon S3 bucket** — they can't be S3-hosted because the SPA needs the backend's socket.io. Deploy = PR → Dagger builds image → bump `packages/homelab/.../versions.ts` pin → ArgoCD.

**Implication:** a "direct S3 upload" only makes sense for the static-bucket sites, and even there the supported path is CI (manual uploads bypass gates and get overwritten).

## Gotchas

### Assets fail on first load (refresh fixes) = SignatureDoesNotMatch 403

Symptom "assets often don't load on first try, refresh fixes it" on any SeaweedFS static site = the single `caddy-s3proxy` pod (`s3-static-sites`, serves every bucket) intermittently gets **`HTTP 403 SignatureDoesNotMatch`** from the SeaweedFS S3 gateway. On any non-2xx, s3proxy serves the (missing) `404.html` → bare 404 → broken asset. Bursty, worst right after a SeaweedFS/Caddy restart; not clock skew. Suspected SeaweedFS 4.28 credential-manager race (unproven).

- Diagnose: `kubectl logs -n s3-static-sites deploy/s3-static-sites | grep SignatureDoesNotMatch` and metric `SeaweedFS_s3_request_total{bucket="",code="403",type="GET"}` (empty bucket label = auth-layer reject).
- Two amplifiers fixed in PR #1328: (1) `S3_ENDPOINT` was unset so Caddy hairpinned via the public `https://seaweedfs.sjer.red` Cloudflare ingress instead of `http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333` — set it in `packages/homelab/.../resources/s3-static-sites/sites.ts`; (2) no `Cache-Control` on hashed assets → every visit re-hit origin. Added per-site `immutableAssetPaths` in `s3-static-site.ts` stamping `Cache-Control: public, max-age=31536000, immutable` on `/_astro/*` + scout `/app/assets/*` (SPA shells excluded). Validate Caddyfile with `dagger call caddyfile-validate`.

### CI deploy fails with S3 500 InternalError = volume-COUNT cap (not disk)

Static-site **Deploy** steps in main CI (`aws s3 sync … --endpoint-url https://seaweedfs.sjer.red`) fail with **HTTP 500 `InternalError` on PutObject** (glacial throughput, ~10min timeout) when `seaweedfs-volume-0` hits its **max volume-count cap** — NOT when disk is full.

- Diagnose: s3 pod log `putToFiler: chunked upload failed: assign volume: … DeadlineExceeded`; `kubectl exec -n seaweedfs seaweedfs-master-0 -- sh -c 'echo "volume.list" | weed shell'` → look for `volume:N/N free:0` and master log `No writable volumes … automatic volume grow failed`. Disk is fine (`DiskPressure: False`); the cap is the **count**.
- Cause: `seaweedfs.ts` `maxVolumes` (auto-detect → ~297 for a 256GiB PVC @ volumeSizeLimit 1000MB). `scout-prod`/`scout-beta` hog ~56% of slots with old match data that accumulates forever; a new write needing a fresh volume (e.g. a `ttl:3M` collection) can't grow → 500. Small deploys pass because their collection still has a non-full writable volume.
- Fixed 2026-06-28 (PR #1344): `maxVolumes 0→360`, data PVC `256Gi→384Gi`. StatefulSet `volumeClaimTemplate` is immutable, so apply live via orphan-recreate: patch the apps Application valuesObject (selfHeal OFF so the patch sticks) + `kubectl patch pvc data-seaweedfs-volume-0 …384Gi` + `kubectl delete sts seaweedfs-volume --cascade=orphan` → ArgoCD recreates the STS with `-max 360`. **Vacuum reclaims bytes, NOT slots.** Single volume replica. Durable follow-ups: trim scout retention; `aws s3 sync --delete` on deploys.

### Public ingress 403s HeadObject and ranged GET

The public SeaweedFS S3 ingress **`https://seaweedfs.sjer.red`** (AWS profile `seaweedfs`) returns **403 on `HeadObject` and on ranged `GetObject` (`Range: bytes=…`)** but serves plain `GetObject` and `ListObjectsV2` fine. To read S3 object user-metadata (`x-amz-meta-*`) against this endpoint, do a plain `GetObject` and immediately cancel the body (`response.Body.transformToWebStream().cancel()`) — never `HeadObjectCommand`. Clients use the default AWS chain + `forcePathStyle: true`; run scripts with `AWS_PROFILE=seaweedfs AWS_ENDPOINT_URL=https://seaweedfs.sjer.red`. (In-cluster consumers should prefer the internal endpoint `http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333`.)
