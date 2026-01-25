import path from "path";

export default {
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
    return [`cd ${mobileDir} && bunx eslint --fix ${relativeFiles}`];
  },
  "packages/clauderon/**/*.rs": (filenames) => {
    // Only run fmt check - clippy and test are too heavy for pre-commit
    // and should be run in CI instead
    return [`sh -c 'cd packages/clauderon && cargo fmt'`];
  },
};
