#!/usr/bin/env bun
/**
 * Quick test script: sign in and list vaults.
 *
 * Usage (with 1Password):
 *   op run --env-file=scripts/.env.op -- bun run scripts/test-auth.ts
 *
 * Usage (manual):
 *   OBSIDIAN_EMAIL=x OBSIDIAN_PASSWORD=y OBSIDIAN_MFA=z bun run scripts/test-auth.ts
 */
import { signIn, listVaults } from "../src/api.ts";

const email = process.env["OBSIDIAN_EMAIL"];
const password = process.env["OBSIDIAN_PASSWORD"];
const mfa = process.env["OBSIDIAN_MFA"];

if (!email || !password) {
  console.error("Set OBSIDIAN_EMAIL and OBSIDIAN_PASSWORD");
  process.exit(1);
}

console.log(`Signing in as ${email}${mfa ? " with MFA" : ""}...`);
try {
  const auth = await signIn(email, password, mfa);
  console.log(`Signed in as ${auth.name} (${auth.email})`);
  console.log(`Token: ${auth.token.slice(0, 10)}...`);

  console.log("\nListing vaults...");
  const { vaults, shared } = await listVaults(auth.token);
  console.log(`Found ${String(vaults.length)} vaults, ${String(shared.length)} shared:`);
  for (const v of vaults) {
    console.log(`  - "${v.name}" (id=${v.id}, host=${v.host}, encryption_v${String(v.encryption_version)})`);
  }
  for (const v of shared) {
    console.log(`  - [shared] "${v.name}" (id=${v.id}, host=${v.host}, encryption_v${String(v.encryption_version)})`);
  }
} catch (e) {
  console.error("Failed:", e);
  process.exit(1);
}
