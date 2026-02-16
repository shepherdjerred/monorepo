#!/usr/bin/env bun

const sdkPath = `${import.meta.dirname}/../sdk/client.gen.ts`;
const content = await Bun.file(sdkPath).text();

// Check if already has the directives
if (content.startsWith("/* eslint-disable */")) {
  console.log("SDK already has eslint-disable directive, skipping");
  process.exit(0);
}

const newContent = `/* eslint-disable */
// @ts-nocheck
${content}`;

await Bun.write(sdkPath, newContent);
console.log("Added eslint-disable and ts-nocheck to SDK");
