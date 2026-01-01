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
  "packages/multiplexer/**/*.rs": () => {
    return [
      "cd packages/multiplexer && cargo fmt --check",
      "cd packages/multiplexer && cargo clippy -- -D warnings",
      "cd packages/multiplexer && cargo test",
    ];
  },
};
