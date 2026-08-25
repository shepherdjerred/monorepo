#!/usr/bin/env bun

// Reads the synth output in dist/ — it never produces it. `build` owns dist/
// and starts with `rm -rf dist/`, so a nested rebuild here deletes the
// directory out from under whatever turbo is running alongside this test:
// `homelab#lint:helm` reads dist/, and `@homelab/cdk8s#lint` walks the package
// root. That race is what failed build 11002 — lint:helm read
// dist/service-probes.k8s.yaml during the window between the rm and the
// re-synth. turbo already orders `test`/`test:ci` after `build`, so dist/ is
// present and current by the time this runs.

const EXPECTED_VALUE = 1;

// Services that should have Intel GPU resources, mapped to their chart files
const GPU_SERVICES: Record<string, string> = {
  plex: "dist/media.k8s.yaml",
  stash: "dist/stash.k8s.yaml",
};

type CheckTally = {
  errors: number;
  successes: number;
};

/** Verify every `gpu.intel.com/i915` occurrence in the file has the expected value. */
function checkGpuValues(
  content: string,
  yamlFile: string,
  tally: CheckTally,
): void {
  const gpuResourcePattern = /gpu\.intel\.com\/i915:\s*(.+)/g;
  const matches = [...content.matchAll(gpuResourcePattern)];

  console.log(
    `📊 Found ${matches.length.toString()} Intel GPU resource(s) in ${yamlFile}`,
  );

  for (const match of matches) {
    if (match[1] == null || match[1] === "") {
      throw new Error(`No match found for ${match.toString()}`);
    }
    const value = match[1].trim();
    const lineNumber = content
      .slice(0, Math.max(0, match.index))
      .split("\n").length;

    if (value === EXPECTED_VALUE.toString()) {
      console.log(
        `✅ Line ${lineNumber.toString()}: gpu.intel.com/i915: ${value} (correct)`,
      );
      tally.successes++;
    } else {
      console.error(
        `❌ Line ${lineNumber.toString()}: gpu.intel.com/i915: ${value} (should be ${EXPECTED_VALUE.toString()})`,
      );
      tally.errors++;
    }
  }
}

/** Verify the named service's own GPU resource request. */
function checkServiceGpuValue(
  content: string,
  service: string,
  yamlFile: string,
  tally: CheckTally,
): void {
  const servicePattern = new RegExp(
    String.raw`name: ${service}[\s\S]*?gpu\.intel\.com\/i915:\s*(.+?)`,
    "g",
  );
  const serviceMatch = servicePattern.exec(content);

  if (serviceMatch?.[1] != null && serviceMatch[1] !== "") {
    const value = serviceMatch[1].trim();
    if (value === EXPECTED_VALUE.toString()) {
      console.log(`✅ Service ${service}: Intel GPU correctly set to ${value}`);
    } else {
      console.error(
        `❌ Service ${service}: Intel GPU incorrectly set to ${value}`,
      );
      tally.errors++;
    }
  } else {
    console.error(
      `❌ Service ${service}: Intel GPU resource not found in ${yamlFile}`,
    );
    tally.errors++;
  }
}

/** Flag null/zero-valued GPU resource declarations. */
function checkProblematicPatterns(
  content: string,
  yamlFile: string,
  tally: CheckTally,
): void {
  const problematicPatterns = [
    /gpu\.intel\.com\/i915:\s*null/g,
    /gpu\.intel\.com\/i915:\s*0\s*$/g,
    /gpu\.intel\.com\/i915:\s*'0'/g,
    /gpu\.intel\.com\/i915:\s*"0"/g,
  ];

  for (const pattern of problematicPatterns) {
    const patternMatches = [...content.matchAll(pattern)];
    if (patternMatches.length > 0) {
      console.error(
        `❌ Found ${patternMatches.length.toString()} problematic pattern(s) in ${yamlFile}: ${pattern.source}`,
      );
      tally.errors++;
    }
  }
}

/** Run every GPU resource check for one service's chart file. */
async function checkServiceFile(
  service: string,
  yamlFile: string,
  tally: CheckTally,
): Promise<void> {
  const file = Bun.file(yamlFile);
  if (!(await file.exists())) {
    throw new Error(
      `${yamlFile} is missing. Run the synth first: \`bunx turbo run build --filter=@homelab/cdk8s\`.`,
    );
  }
  const content = await file.text();

  if (!/gpu\.intel\.com\/i915:\s*.+/.test(content)) {
    console.error(`❌ No Intel GPU resources found in ${yamlFile}`);
    tally.errors++;
    return;
  }

  checkGpuValues(content, yamlFile, tally);
  checkServiceGpuValue(content, service, yamlFile, tally);
  checkProblematicPatterns(content, yamlFile, tally);
}

async function testGpuResources() {
  console.log("🧪 Testing Intel GPU resource allocation...");

  try {
    const tally: CheckTally = { errors: 0, successes: 0 };

    // Check for specific services in their respective chart files
    for (const [service, yamlFile] of Object.entries(GPU_SERVICES)) {
      await checkServiceFile(service, yamlFile, tally);
    }

    console.log(
      `\n📈 Results: ${tally.successes.toString()} successes, ${tally.errors.toString()} errors`,
    );

    if (tally.errors > 0) {
      console.error("❌ GPU resource test failed!");
      process.exit(1);
    } else {
      console.log("✅ All GPU resource tests passed!");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

await testGpuResources();
