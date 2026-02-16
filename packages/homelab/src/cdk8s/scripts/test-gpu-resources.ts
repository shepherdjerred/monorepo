#!/usr/bin/env bun

const EXPECTED_VALUE = 1;

// Services that should have Intel GPU resources, mapped to their chart files
const GPU_SERVICES: Record<string, string> = {
  plex: "dist/media.k8s.yaml",
  pokemon: "dist/pokemon.k8s.yaml",
};

async function testGpuResources() {
  console.log("🧪 Testing Intel GPU resource allocation...");

  try {
    // Build first
    console.log("🔨 Building YAML files...");
    const buildProcess = Bun.spawn(["bun", "run", "build"], {
      cwd: process.cwd(),
      stdio: ["inherit", "inherit", "inherit"],
    });
    const buildStatus = await buildProcess.exited;
    if (buildStatus !== 0) {
      console.error(`❌ Build failed with exit code ${buildStatus.toString()}`);
      process.exit(1);
    }
    console.log("✅ Build completed\n");

    let errors = 0;
    let successes = 0;

    // Check for specific services in their respective chart files
    for (const [service, yamlFile] of Object.entries(GPU_SERVICES)) {
      const file = Bun.file(yamlFile);
      if (!(await file.exists())) {
        console.error(`❌ File ${yamlFile} does not exist after build.`);
        errors++;
        continue;
      }
      const content = await file.text();

      // Find Intel GPU resource references in this file
      const gpuResourcePattern = /gpu\.intel\.com\/i915:\s*(.+)/g;
      const matches = [...content.matchAll(gpuResourcePattern)];

      if (matches.length === 0) {
        console.error(`❌ No Intel GPU resources found in ${yamlFile}`);
        errors++;
      } else {
        console.log(`📊 Found ${matches.length.toString()} Intel GPU resource(s) in ${yamlFile}`);

        for (const match of matches) {
          if (!match[1]) {
            throw new Error(`No match found for ${match.toString()}`);
          }
          const value = match[1].trim();
          const lineNumber = content.substring(0, match.index).split("\n").length;

          if (value === EXPECTED_VALUE.toString()) {
            console.log(`✅ Line ${lineNumber.toString()}: gpu.intel.com/i915: ${value} (correct)`);
            successes++;
          } else {
            console.error(
              `❌ Line ${lineNumber.toString()}: gpu.intel.com/i915: ${value} (should be ${EXPECTED_VALUE.toString()})`,
            );
            errors++;
          }
        }
      }

      // Check for service-specific GPU resource
      const servicePattern = new RegExp(`name: ${service}[\\s\\S]*?gpu\\.intel\\.com\\/i915:\\s*(.+?)`, "g");
      const serviceMatch = servicePattern.exec(content);

      if (serviceMatch?.[1]) {
        const value = serviceMatch[1].trim();
        if (value === EXPECTED_VALUE.toString()) {
          console.log(`✅ Service ${service}: Intel GPU correctly set to ${value}`);
        } else {
          console.error(`❌ Service ${service}: Intel GPU incorrectly set to ${value}`);
          errors++;
        }
      } else {
        console.error(`❌ Service ${service}: Intel GPU resource not found in ${yamlFile}`);
        errors++;
      }

      // Check for problematic patterns
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
          errors++;
        }
      }
    }

    console.log(`\n📈 Results: ${successes.toString()} successes, ${errors.toString()} errors`);

    if (errors > 0) {
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
