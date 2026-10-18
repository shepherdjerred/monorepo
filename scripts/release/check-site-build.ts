#!/usr/bin/env bun
/** Credential-free build validation; never imports archive publication or activation. */
import { prepareStaticSite } from "../lib/sites/build.ts";
await prepareStaticSite(Bun.argv.slice(2), true);
