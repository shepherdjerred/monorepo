import os from "node:os";
import { parseArgs } from "node:util";
import { z } from "zod";
import { resolveBrimProvider } from "#lib/brim/takeover/providers.ts";

const usage = `toolkit agent presence [--json]
toolkit agent scope [--task <short title>] [--issue <AI-123|SJ-123>]

Presence lists live coding agents and the three coding hosts. Scope updates
only the current Herdr terminal. Pass an empty value to clear either label.
Send messages with hc send <address> and record durable handoffs in Tracker Forum.`;

const hosts = ["macbook", "karpathy", "desktop"] as const;
type Host = (typeof hosts)[number];

const MachinesSchema = z.object({
  machines: z.array(
    z.object({ name: z.string(), target: z.string(), state: z.string() }),
  ),
});
const ListSchema = z.object({
  terminals: z.array(
    z.object({
      address: z.string(),
      agent: z.string().nullish(),
      status: z.string().nullish(),
      cwd: z.string().nullish(),
      state: z.string(),
    }),
  ),
});
const DetailSchema = z.object({
  state: z.string(),
  cwd: z.string().nullish(),
  foreground: z.object({ cwd: z.string().nullish() }).nullish(),
  labels: z.record(z.string(), z.string()).nullish(),
});
const localAddress = /^t[0-9a-z]+$/u;
const issueID = /^(?:AI|SJ)-[1-9]\d*$/u;

function codingHost(name: string): Host | undefined {
  switch (name.toLowerCase().split(".")[0] ?? "") {
    case "macbook":
    case "jerreds-macbook-pro":
      return "macbook";
    case "karpathy":
    case "mac-mini":
      return "karpathy";
    case "desktop":
    case "jerred-desktop":
      return "desktop";
    default:
      return undefined;
  }
}

async function hc(args: string[]): Promise<unknown> {
  const child = Bun.spawn(["hc", ...args, "--json"], {
    env: { ...Bun.env, HC_TERMINAL_ID: undefined },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: 10_000,
  });
  const [output, code] = await Promise.all([child.stdout.text(), child.exited]);
  if (code !== 0)
    throw new Error(`hc ${args[0] ?? ""} failed (exit ${String(code)})`);
  return JSON.parse(output) as unknown;
}

type Route = { host: Host; addressPrefix: string | null; connected: boolean };

export function codingRoutes(hostname: string, input: unknown): Route[] {
  const local = codingHost(hostname);
  const { machines } = MachinesSchema.parse(input);
  return hosts.map((host) => {
    if (host === local) return { host, addressPrefix: null, connected: true };
    const peers = machines.filter((machine) => {
      return (codingHost(machine.target) ?? codingHost(machine.name)) === host;
    });
    const route = peers.find((peer) => peer.state === "connected") ?? peers[0];
    return {
      host,
      addressPrefix: route?.name ?? null,
      connected: route?.state === "connected",
    };
  });
}

function isOnRoute(route: Route, address: string): boolean {
  return (
    route.connected &&
    (route.addressPrefix === null
      ? !address.includes("/")
      : address.startsWith(`${route.addressPrefix}/`))
  );
}

function shortLabel(value: string | undefined): string | null {
  const label = value?.trim() ?? "";
  return label.length > 0 && label.length <= 120 && !/\p{Cc}/u.test(label)
    ? label
    : null;
}

async function presence(json: boolean): Promise<void> {
  const [machines, list] = await Promise.all([
    hc(["machine", "ls"]),
    hc(["ls"]),
  ]);
  const routes = codingRoutes(os.hostname(), machines);
  const candidates = ListSchema.parse(list).terminals.flatMap((terminal) => {
    const agent = terminal.agent ?? "";
    if (terminal.state !== "live" || agent.length === 0) return [];
    if (terminal.status == null && resolveBrimProvider(agent) === null)
      return [];
    const route = routes.find((candidate) =>
      isOnRoute(candidate, terminal.address),
    );
    return route === undefined ? [] : [{ terminal, agent, host: route.host }];
  });
  const agents = await Promise.all(
    candidates.map(async ({ terminal, agent, host }) => {
      const basic = {
        host,
        address: terminal.address,
        agent,
        status: terminal.status ?? "unknown",
      };
      try {
        const detail = DetailSchema.parse(await hc(["get", terminal.address]));
        if (detail.state !== "live") return null;
        const issue = detail.labels?.["agent.issue"];
        return {
          ...basic,
          worktree:
            detail.foreground?.cwd ?? detail.cwd ?? terminal.cwd ?? null,
          task: shortLabel(detail.labels?.["agent.task"]),
          issue: issue !== undefined && issueID.test(issue) ? issue : null,
          detailsAvailable: true,
        };
      } catch {
        return {
          ...basic,
          worktree: terminal.cwd ?? null,
          task: null,
          issue: null,
          detailsAvailable: false,
        };
      }
    }),
  );
  const live = agents.filter((agent) => agent !== null);
  if (json) {
    console.log(JSON.stringify({ hosts: routes, agents: live }, null, 2));
    return;
  }
  for (const route of routes) {
    const rows = live.filter((agent) => agent.host === route.host);
    console.log(
      `${route.host} · ${route.connected ? `${String(rows.length)} agents` : "disconnected"}`,
    );
    for (const row of rows) {
      const summary = [
        row.address,
        row.agent,
        row.status,
        row.task,
        row.issue,
        row.worktree,
      ];
      if (!row.detailsAvailable) summary.push("terminal details unavailable");
      console.log(`  ${summary.filter(Boolean).join(" · ")}`);
    }
  }
}

export async function handleAgentCommand(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (
    command === undefined ||
    command === "--help" ||
    rest.includes("--help")
  ) {
    console.log(usage);
    return;
  }
  if (command === "presence") {
    const { values } = parseArgs({
      args: rest,
      options: { json: { type: "boolean" } },
    });
    await presence(values.json ?? false);
    return;
  }
  if (command !== "scope") throw new Error(`Unknown agent command: ${command}`);
  const { values } = parseArgs({
    args: rest,
    options: { task: { type: "string" }, issue: { type: "string" } },
  });
  const address = Bun.env["HC_TERMINAL_ID"];
  if (address === undefined || !localAddress.test(address))
    throw new Error("Run agent scope inside a Herdr terminal");
  const { task, issue } = values;
  if (task === undefined && issue === undefined)
    throw new Error("Provide --task or --issue");
  if (task !== undefined && task !== "" && shortLabel(task) === null)
    throw new Error("Task must be a single short title (120 characters max)");
  if (issue !== undefined && issue !== "" && !issueID.test(issue))
    throw new Error("Issue must be an AI or SJ Tracker identifier");
  await hc([
    "label",
    address,
    ...(task === undefined ? [] : [`agent.task=${task.trim()}`]),
    ...(issue === undefined ? [] : [`agent.issue=${issue}`]),
  ]);
}
