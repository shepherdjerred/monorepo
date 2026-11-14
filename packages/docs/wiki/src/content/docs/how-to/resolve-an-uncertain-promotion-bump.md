---
title: How to resolve an uncertain promotion bump
description: Record an independently reviewed absence decision for one original bump occurrence without sending another action.
---

Resolve one uncertain bump only when independently reviewed official evidence establishes that the original action did not occur.
The [operator resolver](packages/temporal/README.md#the-storm-promotion-task) records `no-action` and leaves the target paused.

1. Identify the exact target and original occurrence with `toolkit promotion status TARGET --json`.
   Confirm the original execution and latest owner have closed.
   Missing history or a running owner blocks resolution.
   Do not resend the bump to discover its outcome.

2. Independently review the official entity and last-bump watermark.
   Establish the exact row ID, name, slug, and tracked listing URL.
   Verify that the official update semantics make the watermark authoritative for a completed bump.
   An enabled button or unrelated old timestamp does not establish absence.

3. Prepare a JSON file matching the [strict evidence schema](packages/temporal/README.md#the-storm-promotion-task).
   Include the original occurrence, attempt timestamp, content hash, and an observation captured after every owning execution closed.
   The first supported evidence kind is `last-bump-watermark`, using `last_bumped_at` older than the attempted bump.
   Include distinct official-source and scoped-observation artifact hashes and the schema's exact independent-review attestation.
   Keep credentials, screenshots, raw pages, and private history out of this file.

4. Hash the exact file bytes and choose one resolution UUID.
   Keep both unchanged through review and readback.

   ```sh
   shasum -a 256 /owned/absence-evidence.json
   uuidgen
   ```

5. Request a plan through the [authenticated toolkit command](packages/toolkit/README.md).
   Substitute the exact target, hash, and UUID.

   ```sh
   toolkit promotion resolve-absence TARGET \
     --evidence-file /owned/absence-evidence.json \
     --evidence-sha256 REVIEWED_SHA256 \
     --resolution-id RESOLUTION_UUID --json
   ```

   Review the returned entity, original occurrence, decision, and state ETag independently.
   Planning reads existing state and owner histories without initializing state or writing an evidence audit.
   Evidence travels through stdin; native process arguments contain only its descriptor path.

6. Apply the reviewed decision by repeating the command with `--apply --expected-state-etag ETAG`.
   Preserve the complete ETag, including any quote characters.
   The resolver archives the sanitized evidence, then attempts one conditional state write.
   A conflict stops the command; a prepared audit alone never means the decision applied.

7. If the command disconnects or its outcome is uncertain, repeat the same request without `--apply`.
   An `already-applied` response requires the original attempt's committed resolution marker and matching immutable audit.
   A `plan` response means no matching committed resolution was found.
   Inspect a conflict before requesting another apply.

8. Confirm `no-action`, the evidence reference, and the paused target using `toolkit promotion status TARGET --json`.
   Resolution preserves cooldowns, failure counters, original run audits, and unrelated attempts.
   Resume separately only after reviewing the underlying execution problem.

## Related

The [promotion command reference](packages/toolkit/README.md) covers ordinary run and read-only reconcile commands.
