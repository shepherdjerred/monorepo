import { restoreLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { assertLatestViewerOrdinalJoints } from "../latest-viewer-ordinal-joints.mjs";

self.onmessage = async ({ data }) => {
  try {
    const assets = await restoreLatestViewerPoseAssets(data);
    let heroes = 0,
      joints = 0;
    for (const hero of data.report.heroes) {
      joints += assertLatestViewerOrdinalJoints(
        assets.createEntry(hero.entityId),
      ).length;
      heroes++;
    }
    self.postMessage({
      ok: true,
      contentHash: assets.contentHash,
      heroes,
      joints,
    });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
