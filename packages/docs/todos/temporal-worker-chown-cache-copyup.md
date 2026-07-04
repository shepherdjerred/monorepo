---
id: temporal-worker-chown-cache-copyup
status: active
origin: packages/docs/logs/2026-07-04_ci-eexist-isolated-linker.md
---

# temporal-worker image: replace `chown -R` of the in-layer bun cache

`withWritableBunInstallCache` (.dagger/src/image.ts) runs
`chown -R 1000:1000 /usr/local/install/cache` as the last build step. The
oven/bun base image sets `BUN_INSTALL=/usr/local`, so this cache is **inside
the image layer** (not the mounted BUN_CACHE volume) and holds the full
temporal dep tree. `chown -R` forces an overlayfs copy-up of every file —
observed as a silent, ~0.1-CPU, 30+ minute exec on cold builds (2026-07-04,
builds 5032/5033), which is what pushed the job past its step timeout. On
warm builds the layer is cached and the cost is invisible.

## Fix direction

Set `BUN_INSTALL_CACHE_DIR=/tmp/bun-install-cache` (or similar UID-1000-
writable path) on the final image and delete the chown step entirely. The
runtime need (UID 1000 got EACCES opening /usr/local/install/cache — see the
docstring) is then satisfied by pointing bun at a writable cache instead of
reassigning ownership of the build-time one.

## Verification required before shipping

temporal-worker has **no smoke test** (its CI step is build-only), so verify
the runtime path by hand: deploy to the cluster (or run the image locally)
and exercise whatever opens the bun cache at runtime (the `claude` CLI /
`bun add -g` paths documented on `withEditorClis`), confirming no EACCES.
