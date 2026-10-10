# Facet Android constraints

Compose owns presentation; Rust owns task/Sync policy. Use root mise Gradle/Java
pins without a Gradle wrapper or per-package lockfile.

- Keep blocking FFI/file/HTTP work off UI. Session effects execute serially with
  bounded ordered callbacks and profile/socket generation fences.
- Validate shared schemas and every positive/negative vector. Open status and
  priority values are configuration, not native enum cases.
- Private replicas use durable atomic exchange and displaced-byte recovery.
  Generic SAF providers need actual CAS and provider-specific acceptance.
- Keystore-backed credentials remain account-owned. Account changes invalidate
  and stop affected sessions before credential removal.
- Preserve complete action envelopes on retries. Dismiss editors only after
  applied receipts; keep drafts on expected failure.
- Package matching arm64-v8a/x86_64 Rust, JNI and JNA libraries. Verify all ELF
  LOAD/APK ZIP alignment plus actual4KiB/16KiB runtime acceptance.
- SDKs, build output, .cxx, credentials and acceptance artifacts stay ignored.

The manifest identity is new and unregistered. Source packaging is separate from
Play enrollment, signing, publication and live-service acceptance.
