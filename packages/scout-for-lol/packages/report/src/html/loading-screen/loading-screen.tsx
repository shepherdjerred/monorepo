import type { LoadingScreenData } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { GameHeader } from "#src/html/loading-screen/game-header.tsx";
import { StandardLayout } from "#src/html/loading-screen/standard-layout.tsx";
import { ArenaLayout } from "#src/html/loading-screen/arena-layout.tsx";
import { match } from "ts-pattern";

export function LoadingScreen({ data }: { data: LoadingScreenData }) {
  const layoutContent = match(data.layout)
    .with("standard", () => <StandardLayout data={data} />)
    .with("aram", () => <StandardLayout data={data} />)
    .with("arena", () => <ArenaLayout data={data} />)
    .exhaustive();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        background: `linear-gradient(180deg, ${palette.grey[6]} 0%, ${palette.blue[6]} 50%, ${palette.grey[6]} 100%)`,
        fontFamily: "Spiegel",
      }}
    >
      <GameHeader data={data} />
      {layoutContent}
    </div>
  );
}
