import { resolve } from "node:path";
import { createLatestAnimationPoses } from "../latest-animation-poses.mjs";
import {
  createAnimationGraph,
  readAnimationAsset,
} from "../latest-animation.mjs";

// Shared CLI binding path matches the viewer's hashed graph/catalog/pose join.
export async function loadAnimationPoses(scenePath) {
  const scene = resolve(scenePath),
    decoder = resolve(scene, "../decoder-16.21-macos"),
    poses = resolve(scene, "../latest-animation-poses"),
    factory = await createLatestAnimationPoses(
      await Bun.file(`${decoder}/profile.json`).json(),
      await Bun.file(`${decoder}/animation-clock.json`).arrayBuffer(),
      await Bun.file(`${poses}/manifest.json`).arrayBuffer(),
    );
  const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
  return {
    async bind(asset) {
      const graphBytes = await Bun.file(
          `${scene}/${asset.animationGraph}`,
        ).arrayBuffer(),
        binding = await factory.bind(
          asset.animationGraph,
          graphBytes,
          await Bun.file(`${scene}/${asset.animationCatalog}`).arrayBuffer(),
        );
      return {
        ...binding,
        graph: createAnimationGraph(
          JSON.parse(new TextDecoder().decode(graphBytes)),
          binding.catalog,
          binding.clock,
        ),
        async read(file) {
          const bytes = await Bun.file(
            `${poses}/${binding.directory}/${file}`,
          ).arrayBuffer();
          if (hash(bytes) !== binding.expectedFileHash(file))
            throw Error("Animation pose bytes differ from package");
          return readAnimationAsset(bytes);
        },
      };
    },
  };
}
