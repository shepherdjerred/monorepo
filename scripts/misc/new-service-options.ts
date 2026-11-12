import { parseArgs } from "node:util";
import { validatePackageName } from "./migration-core.ts";

export type ServiceKind = "web" | "worker";

export type ServiceOptions = {
  /** Package, image, chart, namespace and Argo Application name. */
  name: string;
  kind: ServiceKind;
  /** The port the process listens on: the server's, or a worker's health port. */
  port: number;
  /** A web service's tailnet hostname. */
  host?: string;
  /** The catalog title. */
  title: string;
};

export const USAGE =
  "Usage: bun scripts/misc/new-service.ts --name <kebab-name> --kind web|worker --port <port> [--host <tailnet-host>] [--title <title>]";

const HOST_PATTERN = /^[a-z][a-z0-9-]*$/u;
/** In-image smoke runs bind `port + 10000`, which must stay a valid port. */
const MAX_PORT = 55_535;

function defaultTitle(name: string): string {
  const words = name.replaceAll("-", " ");
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function usage(problem: string): Error {
  return new Error(`${problem}\n${USAGE}`);
}

export function parseServiceOptions(argv: readonly string[]): ServiceOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      name: { type: "string" },
      kind: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      title: { type: "string" },
    },
    strict: true,
  });
  if (values.name === undefined) throw usage("--name is required");
  const name = validatePackageName(values.name);
  const { kind, host } = values;
  if (kind !== "web" && kind !== "worker")
    throw usage("--kind must be web or worker");
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > MAX_PORT)
    throw usage(`--port must be an integer from 1024 to ${String(MAX_PORT)}`);
  if (kind === "web" && host === undefined)
    throw usage("--host is required for a web service");
  if (kind === "worker" && host !== undefined)
    throw usage("--host applies to a web service; a worker has no ingress");
  if (host !== undefined && !HOST_PATTERN.test(host))
    throw usage("--host must be a lowercase tailnet hostname label");
  return {
    name,
    kind,
    port,
    ...(host === undefined ? {} : { host }),
    title: values.title ?? defaultTitle(name),
  };
}
