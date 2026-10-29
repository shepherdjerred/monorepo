#!/usr/bin/env bun
/**
 * Freeze every OpenTofu stack's exact source as an immutable archive.
 *
 * Runs on every default-branch build, unconditionally: Delivery decides
 * whether a stack's archive is new by its digest, so CI never guesses from
 * changed paths. The archive bytes are published only when absent and
 * confirmed by readback; nothing here plans, applies or selects a stack.
 */
import path from "node:path";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import { TOFU_ARCHIVE_METADATA_DIRECTORY } from "../lib/tofu-archive-identity.ts";
import { publishTofuStackArchive } from "../lib/tofu-archive-publication.ts";

const repoRoot = path.resolve(import.meta.dir, "../..");
for (const stack of TofuStackSchema.options) {
  await publishTofuStackArchive({
    stack,
    repoRoot,
    metadataDirectory: path.join(repoRoot, TOFU_ARCHIVE_METADATA_DIRECTORY),
  });
  console.log(`Published OpenTofu archive for ${stack}`);
}
