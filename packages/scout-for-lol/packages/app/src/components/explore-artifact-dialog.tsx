import type {
  ReportAiPreviewSummary,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/dialog";
import { ExploreVisualResult } from "#src/components/explore-visual-result.tsx";

/**
 * A turn's table or chart at more than chat width.
 *
 * The transcript is `max-w-3xl` — right for prose, wrong for a twenty-column
 * result — and everything an Explore answer produces was boxed into it. This
 * is the escape hatch, opened from the turn's action bar.
 *
 * A `Dialog` rather than the design system's `Sheet`: the sheet is hardcoded
 * left-anchored at `min(22rem, 88vw)` with no side prop, so a wide right-hand
 * panel would mean a new design-system variant and the workbench goldens that
 * come with it — for a container. Radix also gives the dialog Escape and focus
 * handling that the composer's own window-level Escape already defers to via
 * `defaultPrevented`.
 *
 * Open state is derived from the nullable artifact rather than held
 * separately, following `rename-conversation-dialog.tsx`, so there is no way
 * to be open with nothing to show.
 */
export type ExploreArtifact = {
  title: string;
  preview: ReportAiPreviewSummary | null;
  visualization: VisualizationSnapshot | null;
};

export function ExploreArtifactDialog(props: {
  readonly artifact: ExploreArtifact | null;
  readonly onClose: () => void;
}) {
  const artifact = props.artifact;
  return (
    <Dialog
      open={artifact !== null}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <DialogContent className="!max-w-[min(96vw,80rem)]">
        <DialogHeader>
          <DialogTitle>{artifact?.title ?? "Result"}</DialogTitle>
        </DialogHeader>
        {artifact !== null && (
          // The table already scrolls inside its own `overflow-x-auto`, so a
          // result wider than even this dialog stays reachable rather than
          // pushing the page sideways.
          <div className="max-h-[70vh] overflow-y-auto">
            <ExploreVisualResult
              preview={artifact.preview}
              visualization={artifact.visualization}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
