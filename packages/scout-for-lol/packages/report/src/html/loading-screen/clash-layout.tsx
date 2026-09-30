import type {
  AramLoadingScreenData,
  StandardLoadingScreenData,
} from "@scout-for-lol/data";
import { getChampionSplashImage } from "#src/dataDragon/image-cache.ts";
import { clashPalette } from "@scout-for-lol/design-system/satori/clash-style";
import { font } from "@scout-for-lol/design-system/satori/fonts";
import { GameHeader } from "#src/html/loading-screen/game-header.tsx";
import { StandardLayout } from "#src/html/loading-screen/standard-layout.tsx";

export function ClashLoadingScreen({
  data,
}: {
  data: StandardLoadingScreenData | AramLoadingScreenData;
}) {
  const tracked = data.participants.find(
    (participant) => participant.isTrackedPlayer,
  );
  const splash =
    tracked === undefined
      ? undefined
      : getChampionSplashImage(tracked.championName);
  const title = data.queueType === "aram clash" ? "ARAM CLASH" : "CLASH";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        backgroundColor: clashPalette.canvas,
        border: `8px solid ${clashPalette.frame}`,
      }}
    >
      {splash === undefined ? null : (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
          }}
        >
          <img
            src={splash}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.16,
            }}
          />
        </div>
      )}
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px 0 24px 0",
          backgroundColor: `${clashPalette.navy}cc`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          <span
            style={{
              fontSize: "48px",
              fontFamily: font.title,
              fontWeight: 700,
              color: clashPalette.title,
              letterSpacing: "6px",
            }}
          >
            {title}
          </span>
          {data.clashChrome?.themeLabel === undefined ? null : (
            <span
              style={{
                fontSize: "18px",
                fontFamily: font.body,
                color: clashPalette.subtitle,
                letterSpacing: "2px",
                textTransform: "uppercase",
              }}
            >
              {data.clashChrome.themeLabel}
            </span>
          )}
        </div>
        <GameHeader data={data} omitTitle />
        <StandardLayout data={data} />
      </div>
    </div>
  );
}
