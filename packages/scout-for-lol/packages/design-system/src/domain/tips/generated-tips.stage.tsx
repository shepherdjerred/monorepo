import type { ReactNode } from "react";
import { generatedFactLoader } from "#src/domain/tips/generated-tips.fixtures.ts";
import { GameFactProvider } from "#src/domain/tooltips/game-fact.tsx";

const loader = generatedFactLoader();

/**
 * Where the tip stories sit: the generated game facts behind every tooltip,
 * and room under the content for a tooltip to open. `width` narrows the
 * column to a phone's.
 */
export function TipStage(props: { width?: string; children: ReactNode }) {
  return (
    <GameFactProvider loader={loader}>
      <div
        style={{
          boxSizing: "border-box",
          minHeight: "34rem",
          maxWidth: props.width ?? "46rem",
          padding: "2rem 1.5rem",
        }}
      >
        {props.children}
      </div>
    </GameFactProvider>
  );
}
