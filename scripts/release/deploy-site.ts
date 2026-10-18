#!/usr/bin/env bun
/** Build and publish an immutable site archive. Delivery alone activates it. */
import { prepareStaticSite } from "../lib/sites/build.ts";
import { publishStaticSiteArchive } from "../lib/static-site-publication.ts";
const args = Bun.argv.slice(2);
const dryRun = args.includes("--dry-run");
const selection = await prepareStaticSite(args, dryRun);
if (selection !== null) {
  if (!dryRun)
    await publishStaticSiteArchive({
      bucket: selection.bucket,
      source: selection.source,
      metadataDirectory: `${selection.root}/.delivery-artifacts`,
    });
  console.log(`Published ${selection.bucket}; activation belongs to Delivery`);
}
