#!/usr/bin/env bun
/**
 * Generates the Caddyfile for S3 static sites.
 * Used for CI validation with caddy validate.
 */
import { generateCaddyfile } from "../src/misc/s3-static-site.ts";
import { staticSites, S3_ENDPOINT } from "../src/resources/s3-static-sites/sites.ts";

const caddyfile = generateCaddyfile({
  sites: staticSites,
  s3Endpoint: S3_ENDPOINT,
});

// Write the Caddyfile to stdout or a file
const outputPath = process.argv[2] ?? "-";
if (outputPath === "-") {
  console.log(caddyfile);
} else {
  await Bun.write(outputPath, caddyfile);
  console.error(`Caddyfile written to ${outputPath}`);
}
