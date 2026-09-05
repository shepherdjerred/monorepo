import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const responses = new Map([
  [
    "/api/states",
    [
      {
        entity_id: "light.demo_lamp",
        state: "off",
        attributes: { friendly_name: "Demo lamp" },
      },
    ],
  ],
  [
    "/api/services",
    [
      {
        domain: "light",
        services: {
          turn_on: {
            fields: {
              brightness: {
                required: false,
                selector: { number: {} },
              },
            },
          },
        },
      },
    ],
  ],
  ["/api/events", [{ event: "state_changed" }]],
  ["/api/config", { version: "demo", components: ["light"] }],
]);

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const body = responses.get(path);
  if (body === undefined) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
});

const outputDirectory = await mkdtemp(join(tmpdir(), "ha-codegen-example-"));
const outputPath = join(outputDirectory, "ha-schema.ts");

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The fixture server did not expose a TCP address.");
  }

  const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      "dist/codegen/cli.js",
      "--url",
      `http://127.0.0.1:${address.port}`,
      "--out",
      outputPath,
    ],
    {
      cwd: packageDirectory,
      env: { ...process.env, HA_TOKEN: "fixture-token" },
      stdio: "ignore",
    },
  );
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`ha-codegen exited with status ${String(code)}.`);
  }

  const generated = await readFile(outputPath, "utf8");
  process.stdout.write(
    generated
      .replace(/^\/\/ Source host: .*$/mu, "// Source host: fixture.local")
      .replace(/^\/\/ Generated at: .*$/mu, "// Generated at: fixture time"),
  );
} finally {
  server.close();
  await rm(outputDirectory, { recursive: true, force: true });
}
