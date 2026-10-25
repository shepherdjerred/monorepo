# CI toolchain image

The CI image contains repository-pinned tools. Its SwiftLint runtime is built
from the exact source archive and compiler image recorded in
`ci/scripts/swiftlint/pins.json`, aligned with the upstream version catalog.

SwiftLint's official 0.65.1 dynamic Linux release requires GLIBC 2.38 and cannot
execute on Debian Bookworm's GLIBC 2.36. Its static release disables SourceKit
checks. The producer therefore compiles the pinned source against the older
Jammy runtime, retains only the declared SourceKit/Swift shared libraries and
licenses, and validates them in Bookworm. The compiler remains in the builder
stage. Compilation inherits a two-CPU affinity and SwiftPM uses two jobs;
each compiler process has an 8 GiB address-space limit. These limits do not
claim an 8 GiB aggregate memory limit for the shared BuildKit worker.

The capability gate runs the actual configured linter on positive and negative
Swift input. It requires every semantic custom rule, variable-shadowing and
SourceKit-dependent statement-position checks to fire, rejects tool crashes
and diagnostics, and proves that unknown configured rules cannot pass.
The ordinary complete Mac and iOS lint commands remain separate required gates.

`ci/scripts/toolchain.sh` calls the shared bootstrap on Linux. A matching
version must pass the capability gate. Missing or older installations use the
existing remote BuildKit endpoint to produce `swiftlint-export`, without
publishing an image. The bootstrap sends only the eight explicit source files
listed in its script, validates the exported archive's checksum and closed
file manifest, verifies upstream pins and capabilities, then selects a private
runtime. It never uploads the whole development workspace or changes a Mac.

Run the bootstrap inside the configured Linux CI container with:

```sh
bash ci/scripts/swiftlint/bootstrap.sh
```

The export contains `runtime.tar.gz`, its checksum and `runtime.manifest.json`.
Their digests are producer outputs, never inputs to the same producer. Preserve
the original frozen source hashes and export when investigating a failed build;
do not substitute a new archive for an uncertain prior outcome.

Normal production image publication remains the repository's CI-image workflow:
`build-ci-image.ts` produces a candidate, `update-ci-image-pin.ts` proposes its
pin, and the existing main-push registration qualifies the pinned CI build
through Delivery. A local export proves its recorded runtime only; it does not
publish an image, update a pin, deploy a workload or prove a complete CI run.
