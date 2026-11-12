import path from "node:path";
import { z } from "zod";
import { domainRegistry } from "homelab/src/domain-registry.ts";
import {
  literalString,
  literalStrings,
  objectEntries,
  parseHcl,
  type HclBlock,
} from "./hcl.ts";
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

const TOFU_ROOT = path.resolve(import.meta.dirname, "../../../tofu");

type Resource = {
  stack: string;
  type: string;
  name: string;
  /** Attribute text: an HCL expression, or the JSON-encoded value. */
  attributes: ReadonlyMap<string, string>;
};

type Stack = {
  name: string;
  /** `.tf` blocks of the root module; empty for a synthesized stack. */
  blocks: readonly HclBlock[];
  resources: readonly Resource[];
  /** `locals` of a synthesized stack; empty for an HCL stack. */
  locals: Readonly<Record<string, unknown>>;
  /** The stack's source with comments removed, for name scans. */
  text: string;
  backendEndpoint: string | undefined;
};

const SynthesizedStackSchema = z.looseObject({
  locals: z.record(z.string(), z.unknown()).optional(),
  resource: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown())))
    .optional(),
  terraform: z.looseObject({
    backend: z
      .looseObject({
        s3: z
          .looseObject({ endpoints: z.looseObject({ s3: z.string() }) })
          .optional(),
      })
      .optional(),
  }),
});

function blocksOf(
  blocks: readonly HclBlock[],
  type: string,
  ...labels: string[]
): HclBlock[] {
  return blocks.filter(
    (block) =>
      block.type === type &&
      labels.every((label, index) => block.labels[index] === label),
  );
}

function hclResources(stack: string, blocks: readonly HclBlock[]): Resource[] {
  return blocksOf(blocks, "resource").map((block) => ({
    stack,
    type: block.labels[0] ?? "",
    name: block.labels[1] ?? "",
    attributes: block.attributes,
  }));
}

/** An attribute's literal string, from either an HCL expression or a JSON value. */
function text(resource: Resource, attribute: string): string | undefined {
  return literalString(resource.attributes.get(attribute));
}

/** Source text with `#` and `//` line comments removed, strings kept. */
function withoutHclComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === "\\") index += 1;
        else if (char === '"') quoted = !quoted;
        else if (!quoted && (char === "#" || line.startsWith("//", index)))
          return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}

async function readHclFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob("*.tf").scan({ cwd: directory }))
    files.push(file);
  return Promise.all(
    files.toSorted().map((file) => Bun.file(path.join(directory, file)).text()),
  );
}

async function readStack(name: string): Promise<Stack> {
  const directory = path.join(TOFU_ROOT, name);
  const synthesized = Bun.file(path.join(directory, "main.tf.json"));
  if (await synthesized.exists()) {
    const source = await synthesized.text();
    const stack = SynthesizedStackSchema.parse(JSON.parse(source));
    return {
      name,
      blocks: [],
      resources: Object.entries(stack.resource ?? {}).flatMap(
        ([type, byName]) =>
          Object.entries(byName).map(([resourceName, attributes]) => ({
            stack: name,
            type,
            name: resourceName,
            attributes: new Map(
              Object.entries(attributes).map(([key, value]) => [
                key,
                JSON.stringify(value),
              ]),
            ),
          })),
      ),
      locals: stack.locals ?? {},
      text: source,
      backendEndpoint: stack.terraform.backend?.s3?.endpoints.s3,
    };
  }
  const sources = await readHclFiles(directory);
  const blocks = sources.flatMap((source) => parseHcl(source));
  const backend = blocksOf(blocks, "terraform")
    .flatMap((terraform) => blocksOf(terraform.blocks, "backend", "s3"))
    .map((s3) => objectEntries(s3.attributes.get("endpoints"))?.get("s3"))[0];
  return {
    name,
    blocks,
    resources: hclResources(name, blocks),
    locals: {},
    text: sources.map((source) => withoutHclComments(source)).join("\n"),
    backendEndpoint: literalString(backend),
  };
}

async function stackNames(): Promise<string[]> {
  const names = new Set<string>();
  for await (const file of new Bun.Glob("*/{*.tf,main.tf.json}").scan({
    cwd: TOFU_ROOT,
  }))
    names.add(file.split("/")[0] ?? "");
  return [...names].toSorted();
}

/** A stack-specific extractor reads HCL; a ported stack needs its JSON reader. */
function hclOnly(stack: Stack, fact: string): readonly HclBlock[] {
  if (stack.blocks.length === 0)
    throw new Error(
      `The ${stack.name} stack is synthesized: read ${fact} from the platform model in readOpenTofuSide`,
    );
  return stack.blocks;
}

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

/** Resolves a `cloudflare_zone.<label>.id` reference to the zone's name. */
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
    const label = reference(expression, /^cloudflare_zone\.(\w+)\.id$/);
    const zone = zones.get(label);
    if (zone === undefined) throw new Error(`Unknown cloudflare_zone.${label}`);
    return zone;
  };
}

/**
 * Tunnel records a child module declares, one set per module instance. Only
 * the domain baseline does: an instance per registered domain, each in that
 * domain's own zone.
 */
async function moduleTunnelRecords(
  stack: Stack,
  call: HclBlock,
  zoneOf: (expression: string | undefined) => string,
): Promise<TunnelRecord[]> {
  const label = `module.${call.labels[0] ?? ""}`;
  const source = literalString(call.attributes.get("source"));
  if (source === undefined) throw new Error(`${label} has no literal source`);
  const sources = await readHclFiles(path.join(TOFU_ROOT, stack.name, source));
  const records = hclResources(
    stack.name,
    sources.flatMap((moduleSource) => parseHcl(moduleSource)),
  ).filter((resource) => pointsAtTunnel(resource));
  if (records.length === 0) return [];
  if (
    call.attributes.get("for_each") !== "local.domain_registry.domains" ||
    call.attributes.get("zone_id") !== "local.baseline_zone_ids[each.key]" ||
    records.some((record) => record.attributes.get("zone_id") !== "var.zone_id")
  )
    throw new Error(
      `${label} declares tunnel records with wiring this reader does not know`,
    );
  const zoneIds = blocksOf(stack.blocks, "locals")
    .map((locals) => objectEntries(locals.attributes.get("baseline_zone_ids")))
    .find((entries) => entries !== undefined);
  return Object.keys(domainRegistry.domains).flatMap((domain) =>
    records.map((record) =>
      tunnelRecord(
        record,
        `${label}["${domain}"].cloudflare_dns_record.${record.name}`,
        zoneOf(zoneIds?.get(domain)),
      ),
    ),
  );
}

async function readCloudflare(
  stack: Stack,
): Promise<
  Pick<OpenTofuSide, "tunnelRecords" | "immutablePathPrefixesByZone">
> {
  const modules = blocksOf(
    hclOnly(stack, "tunnel records and cache rules"),
    "module",
  );
  const zoneOf = zoneResolver(stack);
  const fromModules = await Promise.all(
    modules.map((call) => moduleTunnelRecords(stack, call, zoneOf)),
  );
  return {
    tunnelRecords: [
      ...stack.resources
        .filter((resource) => pointsAtTunnel(resource))
        .map((record) =>
          tunnelRecord(
            record,
            `cloudflare_dns_record.${record.name}`,
            zoneOf(record.attributes.get("zone_id")),
          ),
        ),
      ...fromModules.flat(),
    ],
    immutablePathPrefixesByZone: new Map(
      modules
        .filter(
          (call) =>
            literalString(call.attributes.get("source")) ===
            "./modules/static-cache",
        )
        .map((call) => {
          const prefixes = literalStrings(
            call.attributes.get("asset_prefixes"),
          );
          if (prefixes === undefined)
            throw new Error(
              `module.${call.labels[0] ?? ""} has no literal asset_prefixes`,
            );
          return [zoneOf(call.attributes.get("zone_id")), prefixes.toSorted()];
        }),
    ),
  };
}

function readSeaweedfs(
  stack: Stack,
): Pick<OpenTofuSide, "seaweedfsBuckets" | "expiringPrefixesByBucket"> {
  const blocks = hclOnly(stack, "buckets and lifecycle prefixes");
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
  const prefixes = blocksOf(blocks, "locals")
    .map((locals) =>
      objectEntries(locals.attributes.get("static_site_immutable_prefixes")),
    )
    .find((entries) => entries !== undefined);
  if (prefixes === undefined)
    throw new Error(
      "seaweedfs: local.static_site_immutable_prefixes not found",
    );
  return {
    seaweedfsBuckets,
    expiringPrefixesByBucket: new Map(
      [...prefixes].map(([bucket, expression]) => {
        const values = literalStrings(expression);
        if (values === undefined)
          throw new Error(`seaweedfs: prefixes of ${bucket} are not literals`);
        return [bucket, values];
      }),
    ),
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
  const cloudflare = await readCloudflare(stack("cloudflare"));
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
