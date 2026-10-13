import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useControls, type Controls } from "#src/input/use-controls.ts";
import type { ControlEdge } from "#src/input/pressed-codes.ts";

test("release-all reports each edge's held snapshot", () => {
  const reports: { edge: ControlEdge; held: string[] }[] = [];
  let controls: Controls | undefined;
  function Harness() {
    controls = useControls((edge, held) => {
      reports.push({ edge, held: [...held] });
    });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  if (controls === undefined) throw new Error("controls were not mounted");
  controls.press("up");
  controls.press("a");
  controls.press("a");
  controls.releaseAll();
  controls.releaseAll();
  expect(reports).toEqual([
    { edge: { code: "up", down: true }, held: ["up"] },
    { edge: { code: "a", down: true }, held: ["up", "a"] },
    { edge: { code: "up", down: false }, held: ["a"] },
    { edge: { code: "a", down: false }, held: [] },
  ]);
});
