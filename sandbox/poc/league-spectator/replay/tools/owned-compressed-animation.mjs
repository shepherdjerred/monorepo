// Build an owned copy from exact approved source bytes. Approved source/cache
// files remain immutable; no dependency restore/build targets that checkout.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { actorSha256 } from "./archived-actor-sources.mjs";

const originals = {
  "CompressedAnimationAsset.cs": "df8b0db3cd7868806ac8eac25a609b6da8a3ff476963d632b056c155ef788519",
  "HotFrame.cs": "3842c83cf466042cd08e129bbf8c8d3c82012eeee1af39820e2f9dc2bab2d0a0",
  "CompressedFrame.cs": "689fd40f9430535699db0d4ac98f37b07cfbe68bc62b5ca7d7aecd48c4c5d307",
  "JumpFrame.cs": "1b252c1345addba746054b3ce4dc7c4d2cb2dbf3b7689443ebd69cf9a563a624",
  "Animation.cs": "50d9fb010b591eb1c567cb5bfe3529b7cb012c0468d56236403654b19dd07a85",
  "ErrorMetric.cs": "f29305efd3b42dd39c66b04e32c2c6cb2a9100323d429d1cf7ecfcd49a91ed1a",
  "Interpolators.cs": "dd4d573fe60293d9bfd08c54709a01116f49214e1e60b932e0dfcbcadccab9f6",
};
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error("Pinned compressed sampler source contract changed");
  return source.replace(before, after);
}
export function ownCompressedSource(file, source) {
  let owned = replaceOnce(source.replaceAll("\r\n", "\n"), "namespace LeagueToolkit.Core.Animation;", "using LeagueToolkit.Core.Animation;\nnamespace Scout.ArchivedAnimation;");
  if (file === "HotFrame.cs") {
    owned = replaceOnce(owned, "this.HotFrames = new JointHotFrame[jointCount];", "this.LastEvaluationTime = -1.0f;\n        this.HotFrames = new JointHotFrame[jointCount];");
    for (const [channel, type, value] of [["Rotation", "Quaternion", "Quaternion.Identity"], ["Translation", "Vector", "Vector3.Zero"], ["Scale", "Vector", "Vector3.One"]]) {
      const declaration = `Span<${type}HotFrame> hotFrames = stackalloc ${type}HotFrame[4];`;
      const method = `Initialize${channel}JointHotFrames(`;
      const start = owned.indexOf(method);
      if (start < 0) throw Error("Pinned compressed channel initializer changed");
      const begin = owned.slice(0, start), body = owned.slice(start);
      const block = `if (frameKeys[0] == (frames.Length < 0x10001 ? ushort.MaxValue : -1))\n        {\n            this.HotFrames[jointId] = this.HotFrames[jointId] with\n            {\n                ${channel}P0 = new(0, ${value}),\n                ${channel}P1 = new(0, ${value}),\n                ${channel}P2 = new(ushort.MaxValue, ${value}),\n                ${channel}P3 = new(ushort.MaxValue, ${value})\n            };\n            return;\n        }\n\n        ${declaration}`;
      const position = body.indexOf(declaration);
      if (position < 0) throw Error("Pinned compressed hot-frame allocation changed");
      owned = begin + body.slice(0, position) + block + body.slice(position + declaration.length);
    }
  }
  if (file === "CompressedAnimationAsset.cs") {
    owned = replaceOnce(owned, "ThrowIfDisposed();\n\n        Evaluate(time);", "ThrowIfDisposed();\n        time = Math.Clamp(time, 0.0f, this.Duration);\n\n        Evaluate(time);");
    if (owned.split("br.ReadVector3()").length !== 5 || owned.split("br.ReadExact(").length !== 4)
      throw Error("Pinned compressed binary reader calls changed");
    owned = owned.replaceAll("br.ReadVector3()", "new Vector3(br.ReadSingle(), br.ReadSingle(), br.ReadSingle())");
    owned = owned.replaceAll("br.ReadExact(", "br.BaseStream.ReadExactly(");
    const debug = `    public object InspectJoint(uint hash)\n    {\n        int index = -1;\n        for (int at = 0; at < this._joints.Length; at++) if (this._joints.Span[at] == hash) { index = at; break; }\n        if (index < 0) throw new InvalidDataException("Missing diagnostic joint");\n        var frame = this._evaluator.HotFrames[index];\n        return new { index, this._evaluator.Cursor, this._evaluator.LastEvaluationTime,\n            positionTimes = new[] { frame.TranslationP0.Time, frame.TranslationP1.Time, frame.TranslationP2.Time, frame.TranslationP3.Time },\n            positionValues = new[] { frame.TranslationP0.Value.X, frame.TranslationP0.Value.Y, frame.TranslationP0.Value.Z, frame.TranslationP1.Value.X, frame.TranslationP1.Value.Y, frame.TranslationP1.Value.Z, frame.TranslationP2.Value.X, frame.TranslationP2.Value.Y, frame.TranslationP2.Value.Z, frame.TranslationP3.Value.X, frame.TranslationP3.Value.Y, frame.TranslationP3.Value.Z } };\n    }\n\n    public void Dispose()`;
    owned = replaceOnce(owned, "    public void Dispose()", debug);
  }
  if (file === "Interpolators.cs") {
    const start = owned.indexOf("        return Quaternion.Normalize(");
    const end = owned.indexOf("        );", start);
    if (start < 0 || end < start) throw Error("Pinned quaternion Catmull interpolation changed");
    const native = `        Quaternion value = new()\n        {\n            X = ((m0 * p0.X + m1 * p1.X) + m2 * p2.X) + m3 * p3.X,\n            Y = ((m0 * p0.Y + m1 * p1.Y) + m2 * p2.Y) + m3 * p3.Y,\n            Z = ((m0 * p0.Z + m1 * p1.Z) + m2 * p2.Z) + m3 * p3.Z,\n            W = ((m0 * p0.W + m1 * p1.W) + m2 * p2.W) + m3 * p3.W\n        };\n        // Original 16.21 helper 0x15d0f70: preserve operation order and its\n        // explicit degenerate-norm branch. Constants match the pristine client.\n        float norm = ((value.X * value.X + value.W * value.W) + value.Y * value.Y) + value.Z * value.Z;\n        if (!(norm > BitConverter.Int32BitsToSingle(0x219392ee)))\n        {\n            float component = BitConverter.Int32BitsToSingle(0x3f13ac3c);\n            return new(component, component, component, 0);\n        }\n        return value * (1.0f / MathF.Sqrt(norm));`;
    owned = owned.slice(0, start) + native + owned.slice(end + "        );".length);
  }
  return owned;
}

export async function writeOwnedCompressedSources(sourceCache, build) {
  const destination = path.join(build, "OwnedCompressedAnimation");
  await mkdir(destination, { recursive: true });
  const receipts = [];
  for (const [file, expected] of Object.entries(originals)) {
    const bytes = await Bun.file(path.join(sourceCache, "research/LeagueToolkit/src/LeagueToolkit/Core/Animation", file)).bytes();
    if (actorSha256(bytes) !== expected) throw Error(`Approved compressed source differs: ${file}`);
    const source = ownCompressedSource(file, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    await Bun.write(path.join(destination, file), source);
    receipts.push({ file, originalSha256: expected, ownedSha256: actorSha256(new TextEncoder().encode(source)) });
  }
  return receipts;
}
