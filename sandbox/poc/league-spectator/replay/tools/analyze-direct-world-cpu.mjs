// Bounded CLI CPU samples explain cost; they are not a clean timing gate.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
const path = resolve(process.argv[2]),
  output = resolve(process.argv[3]),
  bytes = await Bun.file(path).bytes(),
  profile = JSON.parse(new TextDecoder().decode(bytes)),
  nodes = new Map(profile.nodes.map((node) => [node.id, node])),
  parents = new Map();
for (const node of nodes.values())
  for (const child of node.children ?? []) parents.set(child, node.id);
const self = new Map(),
  inclusive = new Map(),
  cloneCallers = new Map(),
  subarrayCallers = new Map();
let total = 0,
  samples = 0;
const label = (node) =>
  `${node.callFrame.functionName} ${node.callFrame.url.split("/").at(-1)}:${node.callFrame.lineNumber + 1}`;
const add = (map, key, value) => map.set(key, (map.get(key) ?? 0) + value);
for (let i = 0; i < profile.samples.length; i++) {
  const chain = [];
  for (let id = profile.samples[i]; nodes.has(id); id = parents.get(id))
    chain.push(nodes.get(id));
  if (
    !chain.some(
      (node) => node.callFrame.functionName === "sampleComparisonPlayback",
    )
  )
    continue;
  const ms = profile.timeDeltas[i] / 1000;
  total += ms;
  samples++;
  add(self, label(chain[0]), ms);
  for (const key of new Set(chain.map(label))) add(inclusive, key, ms);
  if (chain[0].callFrame.functionName === "structuredClone" && chain[1])
    add(cloneCallers, label(chain[1]), ms);
  if (chain[0].callFrame.functionName === "subarray" && chain[1])
    add(subarrayCallers, label(chain[1]), ms);
}
if (!samples || !Number.isFinite(total))
  throw Error("Named production playback CPU samples required");
const sorted = (map, limit) =>
  [...map]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, ms]) => ({
      key,
      ms,
      pct: Math.round((ms / total) * 1000) / 10,
    }));
const result = {
  schema: 1,
  profilePath: path,
  profileSha256: await sha256(bytes),
  playbackSampledMs: total,
  samples,
  self: sorted(self, 40),
  inclusive: sorted(inclusive, 60),
  structuredCloneCallers: sorted(cloneCallers, 40),
  subarrayCallers: sorted(subarrayCallers, 40),
  scope:
    "CLI production handler CPU samples only; initialization excluded by named playback ancestor; not a performance gate",
};
await Bun.write(output, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    playbackSampledMs: total,
    samples,
    self: result.self.slice(0, 10),
    cloneCallers: result.structuredCloneCallers.slice(0, 10),
  }),
);
