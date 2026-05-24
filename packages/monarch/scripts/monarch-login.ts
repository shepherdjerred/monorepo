console.error(
  [
    "Password login is no longer supported by Monarch's current web API.",
    "Run `bun run login` to capture a browser session instead.",
  ].join("\n"),
);
process.exit(1);
