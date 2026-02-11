import path from "path";

export default {
  "**/package.json": () => {
    // Verify lockfile is up to date when package.json changes
    return ["bun install --frozen-lockfile"];
  },
  "packages/*/src/**/*.{ts,tsx,js,jsx}": (filenames) => {
    // Group files by package
    const packageMap = new Map();

    for (const filename of filenames) {
      const match = filename.match(/^packages\/([^/]+)\//);
      if (match) {
        const packageName = match[1];
        if (!packageMap.has(packageName)) {
          packageMap.set(packageName, []);
        }
        packageMap.get(packageName).push(filename);
      }
    }

    // Run eslint for each package
    const commands = [];
    for (const [packageName, files] of packageMap) {
      const packageDir = `packages/${packageName}`;
      const relativeFiles = files.map(f => path.relative(packageDir, f)).join(" ");
      commands.push(`cd ${packageDir} && bunx eslint --fix ${relativeFiles}`);
    }

    return commands;
  },
  // Clauderon mobile (React Native) - nested package needs separate pattern
  "packages/clauderon/mobile/src/**/*.{ts,tsx}": (filenames) => {
    const mobileDir = "packages/clauderon/mobile";
    const relativeFiles = filenames.map(f => path.relative(mobileDir, f)).join(" ");
    return [
      `cd ${mobileDir} && bunx eslint --fix ${relativeFiles}`,
      `cd ${mobileDir} && bunx prettier --check ${relativeFiles}`,
    ];
  },
  // Clauderon web packages - nested workspace
  "packages/clauderon/web/*/src/**/*.{ts,tsx}": (filenames) => {
    const packageMap = new Map();

    for (const filename of filenames) {
      const match = filename.match(/^packages\/clauderon\/web\/([^/]+)\//);
      if (match) {
        const packageName = match[1];
        if (!packageMap.has(packageName)) {
          packageMap.set(packageName, []);
        }
        packageMap.get(packageName).push(filename);
      }
    }

    const commands = [];
    for (const [packageName, files] of packageMap) {
      const packageDir = `packages/clauderon/web/${packageName}`;
      const relativeFiles = files.map(f => path.relative(packageDir, f)).join(" ");
      commands.push(`cd ${packageDir} && bunx eslint --fix ${relativeFiles}`);
    }

    return commands;
  },
  // Clauderon docs
  "packages/clauderon/docs/src/**/*.{ts,tsx}": (filenames) => {
    const docsDir = "packages/clauderon/docs";
    const relativeFiles = filenames.map(f => path.relative(docsDir, f)).join(" ");
    return [`cd ${docsDir} && bunx eslint --fix ${relativeFiles}`];
  },
  // Discord Plays Pokemon sub-packages
  "packages/dpp/*/src/**/*.{ts,tsx,js,jsx}": (filenames) => {
    const packageMap = new Map();

    for (const filename of filenames) {
      const match = filename.match(/^packages\/dpp\/([^/]+)\//);
      if (match) {
        const packageName = match[1];
        if (!packageMap.has(packageName)) {
          packageMap.set(packageName, []);
        }
        packageMap.get(packageName).push(filename);
      }
    }

    const commands = [];
    for (const [packageName, files] of packageMap) {
      const packageDir = `packages/dpp/${packageName}`;
      const relativeFiles = files.map(f => path.relative(packageDir, f)).join(" ");
      commands.push(`cd ${packageDir} && bunx eslint --fix ${relativeFiles}`);
    }

    return commands;
  },
  // Homelab sub-packages
  "packages/homelab/*/src/**/*.{ts,tsx,js,jsx}": (filenames) => {
    const packageMap = new Map();

    for (const filename of filenames) {
      const match = filename.match(/^packages\/homelab\/([^/]+)\//);
      if (match) {
        const packageName = match[1];
        if (!packageMap.has(packageName)) {
          packageMap.set(packageName, []);
        }
        packageMap.get(packageName).push(filename);
      }
    }

    const commands = [];
    for (const [packageName, files] of packageMap) {
      const packageDir = `packages/homelab/${packageName}`;
      const relativeFiles = files.map(f => path.relative(packageDir, f)).join(" ");
      commands.push(`cd ${packageDir} && bunx eslint --fix ${relativeFiles}`);
    }

    return commands;
  },
  // Scout sub-packages
  "packages/scout/*/src/**/*.{ts,tsx,js,jsx}": (filenames) => {
    const packageMap = new Map();

    for (const filename of filenames) {
      const match = filename.match(/^packages\/scout\/([^/]+)\//);
      if (match) {
        const packageName = match[1];
        if (!packageMap.has(packageName)) {
          packageMap.set(packageName, []);
        }
        packageMap.get(packageName).push(filename);
      }
    }

    const commands = [];
    for (const [packageName, files] of packageMap) {
      const packageDir = `packages/scout/${packageName}`;
      const relativeFiles = files.map(f => path.relative(packageDir, f)).join(" ");
      commands.push(`cd ${packageDir} && bunx eslint --fix ${relativeFiles}`);
    }

    return commands;
  },
  // .dagger CI pipeline
  ".dagger/src/**/*.ts": (filenames) => {
    const daggerDir = ".dagger";
    const relativeFiles = filenames.map(f => path.relative(daggerDir, f)).join(" ");
    return [`cd ${daggerDir} && bunx eslint --fix ${relativeFiles}`];
  },
  "packages/clauderon/**/*.rs": (filenames) => {
    // Format only in lint-staged (clippy/test run in Tier 2 of pre-commit hook)
    return [`sh -c 'cd packages/clauderon && cargo fmt'`];
  },
  "**/*.sh": (filenames) => {
    const filtered = filenames.filter(
      (f) => !f.includes("node_modules") && !f.includes("Pods"),
    );
    return filtered.length > 0
      ? [`shellcheck --severity=warning ${filtered.join(" ")}`]
      : [];
  },
};
