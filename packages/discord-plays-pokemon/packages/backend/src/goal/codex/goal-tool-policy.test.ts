import { afterEach, expect, it } from "vitest";
import { Codex } from "@openai/codex-sdk";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { goalToolPolicy } from "./goal-tool-policy.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

function responseEvent(type: string, data: Record<string, unknown>) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

it("allows semantic controls while denying shell execution and credential reads in the real Codex runtime", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pokemon-tool-boundary-"));
  roots.push(root);
  const home = path.join(root, "auth");
  await mkdir(home);
  const authFile = path.join(home, "auth.json");
  const credential = JSON.stringify({
    auth_mode: "apikey",
    OPENAI_API_KEY: "SYNTHETIC_PRIVATE_CREDENTIAL",
  });
  await writeFile(authFile, credential);
  const controlCalls: string[] = [];
  const control = Bun.serve({
    port: 0,
    fetch(request) {
      controlCalls.push(new URL(request.url).pathname);
      expect(request.headers.get("authorization")).toBe(
        "Bearer synthetic-control",
      );
      expect(request.headers.get("x-pokemon-goal-id")).toBe("synthetic-goal");
      return Response.json({ status: "SEMANTIC_CONTROL_READY" });
    },
  });
  const patch = (file: string) =>
    `text(await tools.apply_patch(${JSON.stringify(`*** Begin Patch\n*** Update File: ${file}\n@@\n+probe\n*** End Patch`)}));`;
  const scripts = [
    'text(await tools.mcp__pokemon__pokemonctl({args:["status"]}));',
    'text(await tools.exec_command({cmd:"printenv"}));',
    patch(authFile),
    patch("/proc/1/environ"),
    "text(process.env);",
    'text(await import("node:fs/promises"));',
    'text(await fetch("https://example.com"));',
  ];
  const requests: string[] = [];
  const provider = Bun.serve({
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json();
      requests.push(JSON.stringify(body));
      const index = requests.length - 1;
      const script = scripts[index];
      const item =
        script === undefined
          ? {
              type: "message",
              id: "msg_synthetic",
              role: "assistant",
              content: [{ type: "output_text", text: "Boundary verified." }],
            }
          : {
              type: "custom_tool_call",
              call_id: `call_${String(index)}`,
              name: "exec",
              namespace: "functions",
              input: script,
            };
      return new Response(
        responseEvent("response.created", {
          response: {
            id: `resp_${String(index)}`,
            status: "in_progress",
            output: [],
          },
        }) +
          responseEvent("response.output_item.done", {
            output_index: 0,
            item,
          }) +
          responseEvent("response.completed", {
            response: {
              id: `resp_${String(index)}`,
              status: "completed",
              output: [item],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  try {
    const environment = {
      PATH: Bun.env["PATH"] ?? "",
      HOME: root,
      CODEX_HOME: home,
      POKEMONCTL_URL: `http://127.0.0.1:${String(control.port)}`,
      POKEMONCTL_TOKEN: "synthetic-control",
      POKEMONCTL_GOAL_ID: "synthetic-goal",
    };
    const codex = new Codex({
      env: environment,
      config: {
        ...goalToolPolicy(environment, root),
        project_doc_max_bytes: 0,
        model_provider: "boundary-test",
        model_providers: {
          "boundary-test": {
            name: "synthetic local fixture",
            base_url: `http://127.0.0.1:${String(provider.port)}`,
            wire_api: "responses",
            requires_openai_auth: false,
            request_max_retries: 0,
            stream_max_retries: 0,
          },
        },
      },
    });
    const result = await codex
      .startThread({
        model: "gpt-5.6-sol",
        approvalPolicy: "never",
        skipGitRepoCheck: true,
        workingDirectory: root,
        webSearchMode: "disabled",
      })
      .run("Synthetic tool boundary test.", {
        signal: AbortSignal.timeout(15_000),
      });
    expect(result.finalResponse).toBe("Boundary verified.");
    expect(controlCalls).toEqual(["/status"]);
    expect(requests).toHaveLength(8);
    expect(requests[1]).toContain("SEMANTIC_CONTROL_READY");
    expect(requests[2]).toContain("exec_command is not a function");
    expect(requests[3]).toContain("Failed to read file");
    expect(requests[4]).toContain("Failed to read file");
    expect(requests[5]).toContain("process is not defined");
    expect(requests[6]).toContain("unsupported import in exec");
    expect(requests[7]).toContain("fetch is not defined");
    expect(requests.join("\n")).not.toContain("SYNTHETIC_PRIVATE_CREDENTIAL");
    expect(await readFile(authFile, "utf8")).toBe(credential);
  } finally {
    await provider.stop(true);
    await control.stop(true);
  }
}, 20_000);
