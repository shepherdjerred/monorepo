/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/(application|infrastructure|server|client)" },
    },
    {
      name: "application-does-not-depend-on-adapters",
      severity: "error",
      from: { path: "^src/application" },
      to: { path: "^src/(infrastructure|server|client)" },
    },
    {
      name: "infrastructure-does-not-depend-on-transports",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: { path: "^src/(server|client)" },
    },
    {
      name: "server-does-not-depend-on-client",
      severity: "error",
      from: { path: "^src/server" },
      to: { path: "^src/client" },
    },
    {
      name: "client-does-not-import-server-runtime",
      severity: "error",
      from: { path: "^src/client" },
      to: { path: "^src/server", dependencyTypesNot: ["type-only"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  },
};
