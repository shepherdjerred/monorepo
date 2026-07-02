import { getChampionLoadingImage } from "#src/dataDragon/image-cache.ts";
import { palette } from "#src/assets/colors.ts";

/**
 * Full-bleed champion loading-screen art used as the hero background for the
 * ranked-banner and ranked-square designs. Renders an absolutely-positioned
 * image with a dark vignette gradient over it so content laid on top stays
 * legible.
 *
 * Must be the first child of a flex container with `position: "relative"`.
 * Caller must pass the parent's pixel dimensions because Satori resolves
 * positioned-image width/height against numeric parent extents, not nested
 * percentages.
 *
 * Caller must preload the loading image via `preloadChampionLoadingImages`.
 */
export function Splash({
  championName,
  width,
  height,
  skinNum = 0,
  vignette = "left",
}: {
  championName: string;
  width: number;
  height: number;
  skinNum?: number;
  vignette?: "left" | "bottom" | "both";
}) {
  const src = getChampionLoadingImage(championName, skinNum);
  const dark = palette.grey[6];

  const overlay =
    vignette === "left"
      ? `linear-gradient(90deg, ${dark} 0%, rgba(1, 10, 19, 0.55) 45%, rgba(1, 10, 19, 0.15) 100%)`
      : vignette === "bottom"
        ? `linear-gradient(180deg, rgba(1, 10, 19, 0.05) 0%, rgba(1, 10, 19, 0.65) 65%, ${dark} 100%)`
        : `linear-gradient(135deg, ${dark} 0%, rgba(1, 10, 19, 0.45) 45%, rgba(1, 10, 19, 0.85) 100%)`;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: `${width.toString()}px`,
        height: `${height.toString()}px`,
        display: "flex",
        overflow: "hidden",
        backgroundImage: `url(${src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          width: `${width.toString()}px`,
          height: `${height.toString()}px`,
          display: "flex",
          backgroundImage: overlay,
        }}
      />
    </div>
  );
}
