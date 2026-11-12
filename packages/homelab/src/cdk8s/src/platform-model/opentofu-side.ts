import path from "node:path";
import { z } from "zod";
import { literalString, objectEntries } from "./hcl.ts";
import {
  TOFU_ROOT,
  blocksOf,
  readStack,
  stackNames,
  text,
  type Resource,
  type Stack,
} from "./opentofu-stack.ts";
import { tailnetNamesIn } from "./tailnet-names.ts";
import { readTailscale } from "./tailscale-side.ts";

/**
 * What the OpenTofu stacks declare for the facts in the platform model.
 *
 * `readOpenTofuSide` is the only way the "rendered on both sides" test sees
 * OpenTofu. A stack is read from its committed `main.tf.json` when the CDK
 * Terrain app has ported it, otherwise from its `.tf` files. When the stacks
 * render the platform model directly, this reader is replaced by the model
 * and its callers do not change.
 */
export type OpenTofuSide = {
  /** Every DNS record that points at a Cloudflare Tunnel. */
  tunnelRecords: readonly {
    /** Where the record is declared, for failure messages. */
    address: string;
    fqdn: string;
    /** The record content: `<tunnel id>.cfargotunnel.com`. */
    target: string;
    proxied: boolean;
  }[];
  /** URL path prefixes cached as immutable, by Cloudflare zone. */
  immutablePathPrefixesByZone: ReadonlyMap<string, readonly string[]>;
  seaweedfsBuckets: ReadonlySet<string>;
  /** Bucket key prefixes whose old objects expire, by SeaweedFS bucket. */
  expiringPrefixesByBucket: ReadonlyMap<string, readonly string[]>;
  /** Tags the tailnet policy assigns an owner. */
  tailscaleTags: ReadonlySet<string>;
  /** Every 1Password item a stack writes. */
  onePasswordItems: readonly {
    stack: string;
    /** `<type>.<name>`. */
    resource: string;
    title: string;
    vault: string;
  }[];
  /** Every `<host>.<tailnet>` name a stack mentions outside comments. */
  tailnetNames: readonly { stack: string; host: string; domain: string }[];
  /** The S3 endpoint of every stack's state backend. */
  stateBackendEndpoints: readonly { stack: string; endpoint: string }[];
};

function reference(expression: string | undefined, pattern: RegExp): string {
  const match = pattern.exec(expression ?? "");
  if (match?.[1] === undefined)
    throw new Error(
      `Unsupported OpenTofu reference: ${expression ?? "(none)"}`,
    );
  return match[1];
}

function recordFqdn(name: string, zone: string): string {
  return name === zone || name.endsWith(`.${zone}`) ? name : `${name}.${zone}`;
}

type TunnelRecord = OpenTofuSide["tunnelRecords"][number];

function pointsAtTunnel(record: Resource): boolean {
  return (
    record.type === "cloudflare_dns_record" &&
    (text(record, "content") ?? "").endsWith(".cfargotunnel.com")
  );
}

/** A record that points at a tunnel, as declared at `address` in `zone`. */
function tunnelRecord(
  record: Resource,
  address: string,
  zone: string,
): TunnelRecord {
  const name = text(record, "name");
  if (name === undefined || text(record, "type") !== "CNAME")
    throw new Error(`${address} points at a tunnel without a literal CNAME`);
  for (const meta of ["count", "for_each"])
    if (record.attributes.has(meta))
      throw new Error(`${address} uses ${meta}: its names cannot be read`);
  return {
    address,
    fqdn: recordFqdn(name, zone),
    target: text(record, "content") ?? "",
    proxied: record.attributes.get("proxied") === "true",
  };
}

/**
 * Resolves a synthesized `"${cloudflare_zone.<label>.id}"` reference, given as
 * its JSON text, to the zone's name.
 */
function zoneResolver(
  stack: Stack,
): (expression: string | undefined) => string {
  const zones = new Map(
    stack.resources
      .filter((resource) => resource.type === "cloudflare_zone")
      .map((zone) => {
        const name = text(zone, "name");
        if (name === undefined)
          throw new Error(`cloudflare_zone.${zone.name} has no literal name`);
        return [zone.name, name] as const;
      }),
  );
  return (expression) => {
    const label = reference(
      unwrapInterpolation(expression),
      /^cloudflare_zone\.(\w+)\.id$/,
    );
    const zone = zones.get(label);
    if (zone === undefined) throw new Error(`Unknown cloudflare_zone.${label}`);
    return zone;
  };
}

const CacheRulesSchema = z.array(z.looseObject({ expression: z.string() }));
const CACHED_PREFIX = /^starts_with\(http\.request\.uri\.path, "([^"]+)"\)$/;

/**
 * The path prefixes a zone's static-asset cache ruleset matches: its one
 * rule is `starts_with(http.request.uri.path, "<prefix>")` joined by `or`.
 */
function cachedPrefixes(ruleset: Resource): string[] {
  const address = `cloudflare_ruleset.${ruleset.name}`;
  const rules = CacheRulesSchema.safeParse(
    JSON.parse(ruleset.attributes.get("rules") ?? "null"),
  );
  const [rule] = rules.success ? rules.data : [];
  if (rule === undefined || rules.data?.length !== 1)
    throw new Error(`${address} is not a single cache rule`);
  return rule.expression
    .split(" or ")
    .map((clause) => {
      const prefix = CACHED_PREFIX.exec(clause)?.[1];
      if (prefix === undefined)
        throw new Error(`${address} matches something other than a prefix`);
      return prefix;
    })
    .toSorted();
}

/**
 * The cloudflare stack is synthesized and holds no module: every record and
 * cache ruleset is a root resource of `main.tf.json`.
 */
function readCloudflare(
  stack: Stack,
): Pick<OpenTofuSide, "tunnelRecords" | "immutablePathPrefixesByZone"> {
  if (stack.blocks.length > 0 || stack.modules.length > 0)
    throw new Error(
      "cloudflare: expected a synthesized main.tf.json without module calls; update readCloudflare",
    );
  const zoneOf = zoneResolver(stack);
  return {
    tunnelRecords: stack.resources
      .filter((resource) => pointsAtTunnel(resource))
      .map((record) =>
        tunnelRecord(
          record,
          `cloudflare_dns_record.${record.name}`,
          zoneOf(record.attributes.get("zone_id")),
        ),
      ),
    immutablePathPrefixesByZone: new Map(
      stack.resources
        .filter(
          (resource) =>
            resource.type === "cloudflare_ruleset" &&
            text(resource, "phase") === "http_request_cache_settings",
        )
        .map((ruleset) => [
          zoneOf(ruleset.attributes.get("zone_id")),
          cachedPrefixes(ruleset),
        ]),
    ),
  };
}

/**
 * The seaweedfs stack is synthesized: its hashed-asset lifecycle rules iterate
 * `local.static_site_immutable_prefixes`. Anything else fails here, so the
 * prefixes are never read from a local the rules do not apply.
 */
function readSeaweedfs(
  stack: Stack,
): Pick<OpenTofuSide, "seaweedfsBuckets" | "expiringPrefixesByBucket"> {
  const seaweedfsBuckets = new Set(
    stack.resources
      .filter((resource) => resource.type === "aws_s3_bucket")
      .map((bucket) => {
        const name = text(bucket, "bucket");
        if (name === undefined)
          throw new Error(`aws_s3_bucket.${bucket.name} has no literal bucket`);
        return name;
      }),
  );
  const lifecycle = stack.resources.find(
    (resource) =>
      resource.type === "terraform_data" &&
      resource.name === "static_site_asset_lifecycle",
  );
  if (
    unwrapInterpolation(lifecycle?.attributes.get("for_each")) !==
    "local.static_site_immutable_prefixes"
  )
    throw new Error(
      "seaweedfs: static_site_asset_lifecycle does not iterate local.static_site_immutable_prefixes; update readSeaweedfs",
    );
  const prefixes = z
    .record(z.string(), z.array(z.string()))
    .parse(stack.locals["static_site_immutable_prefixes"]);
  return {
    seaweedfsBuckets,
    expiringPrefixesByBucket: new Map(Object.entries(prefixes)),
  };
}

/**
 * A reference attribute such as `var.x` or `each.value.y`: bare in HCL, and a
 * `"${...}"` string in a synthesized stack's JSON.
 */
function unwrapInterpolation(
  expression: string | undefined,
): string | undefined {
  return expression === undefined
    ? undefined
    : (/^"\$\{([^"]*)\}"$/.exec(expression)?.[1] ?? expression);
}

const TitledEntriesSchema = z.record(
  z.string(),
  z.looseObject({ title: z.string() }),
);

/** Titles a `for_each` item resource takes from its stack's own data. */
function onePasswordTitles(stack: Stack, item: Resource): string[] {
  const literal = text(item, "title");
  if (literal !== undefined) return [literal];
  const title = unwrapInterpolation(item.attributes.get("title"));
  const rawSource = item.attributes.get("for_each");
  const source = unwrapInterpolation(rawSource);
  if (title === "each.value.title" && rawSource?.startsWith("{") === true) {
    // A synthesized stack inlines the for_each map as a JSON object.
    return Object.values(TitledEntriesSchema.parse(JSON.parse(rawSource))).map(
      (entry) => entry.title,
    );
  }
  if (title === "each.value.title" && source?.startsWith("local.") === true) {
    const entries = blocksOf(stack.blocks, "locals")
      .map((locals) =>
        objectEntries(locals.attributes.get(source.slice("local.".length))),
      )
      .find((found) => found !== undefined);
    const titles = [...(entries ?? new Map<string, string>()).values()].map(
      (entry) => literalString(objectEntries(entry)?.get("title")),
    );
    if (titles.length > 0 && titles.every((value) => value !== undefined))
      return titles;
  }
  if (
    title === "each.value.onepassword_item_title" &&
    source?.startsWith("var.") === true
  )
    // The platform model reads these titles from the same desired state.
    return [];
  throw new Error(
    `${stack.name}: onepassword_item.${item.name} has a title this reader cannot resolve`,
  );
}

const DesiredStateTitlesSchema = z.record(
  z.string(),
  z.looseObject({ onepassword_item_title: z.string() }),
);

async function readOnePasswordItems(
  stack: Stack,
): Promise<OpenTofuSide["onePasswordItems"]> {
  const items: OpenTofuSide["onePasswordItems"][number][] = [];
  for (const item of stack.resources.filter(
    (resource) => resource.type === "onepassword_item",
  )) {
    const resource = `onepassword_item.${item.name}`;
    const vaultExpression = item.attributes.get("vault");
    const vault =
      literalString(vaultExpression) ??
      blocksOf(stack.blocks, "locals")
        .map((locals) =>
          literalString(
            locals.attributes.get(
              (vaultExpression ?? "").replace(/^local\./, ""),
            ),
          ),
        )
        .find((found) => found !== undefined);
    if (vault === undefined)
      throw new Error(`${stack.name}: ${resource} has no resolvable vault`);
    const titles = onePasswordTitles(stack, item);
    const variable = /^var\.(\w+)$/.exec(
      unwrapInterpolation(item.attributes.get("for_each")) ?? "",
    )?.[1];
    if (variable !== undefined && titles.length === 0) {
      const desiredState: unknown = await Bun.file(
        path.join(TOFU_ROOT, stack.name, "desired-state.json"),
      ).json();
      const workloads = DesiredStateTitlesSchema.parse(
        z.looseObject({ [variable]: z.unknown() }).parse(desiredState)[
          variable
        ],
      );
      titles.push(
        ...Object.values(workloads).map(
          (workload) => workload.onepassword_item_title,
        ),
      );
    }
    for (const title of titles)
      items.push({ stack: stack.name, resource, title, vault });
  }
  return items;
}

export async function readOpenTofuSide(): Promise<OpenTofuSide> {
  const names = await stackNames();
  const stacks = await Promise.all(names.map((name) => readStack(name)));
  const stack = (name: string): Stack => {
    const found = stacks.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`No OpenTofu stack ${name}`);
    return found;
  };
  const itemsByStack = await Promise.all(
    stacks.map((candidate) => readOnePasswordItems(candidate)),
  );
  const cloudflare = readCloudflare(stack("cloudflare"));
  return {
    ...cloudflare,
    ...readSeaweedfs(stack("seaweedfs")),
    ...readTailscale(stack("tailscale")),
    onePasswordItems: itemsByStack.flat(),
    tailnetNames: stacks.flatMap((candidate) =>
      tailnetNamesIn(candidate.text).map((name) => ({
        stack: candidate.name,
        ...name,
      })),
    ),
    stateBackendEndpoints: stacks.flatMap((candidate) =>
      candidate.backendEndpoint === undefined
        ? []
        : [{ stack: candidate.name, endpoint: candidate.backendEndpoint }],
    ),
  };
}
