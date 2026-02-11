import { Accordion } from "@shepherdjerred/scout-frontend/components/review-tool/ui/accordion";
import type { PipelineStagesConfig } from "@shepherdjerred/scout-frontend/lib/review-tool/config/schema";
import { ImageGenerationPanel } from "./image-generation-panel.tsx";
import { StageConfigPanel } from "./stage-config-panel.tsx";

type StageConfigSectionsProps = {
  stages: PipelineStagesConfig;
  onChange: (next: PipelineStagesConfig) => void;
};

export function StageConfigSections({ stages, onChange }: StageConfigSectionsProps) {
  return (
    <Accordion
      items={[
        {
          id: "stage-1a",
          title: "Stage 1a: Timeline Summary",
          content: (
            <StageConfigPanel
              type="toggleable"
              title="Timeline Summary"
              description="Summarize curated timeline JSON to text"
              stageName="timelineSummary"
              config={stages.timelineSummary}
              onChange={(next) => {
                onChange({ ...stages, timelineSummary: next });
              }}
            />
          ),
        },
        {
          id: "stage-1b",
          title: "Stage 1b: Match Summary",
          content: (
            <StageConfigPanel
              type="toggleable"
              title="Match Summary"
              description="Summarize match JSON to text for the selected player"
              stageName="matchSummary"
              config={stages.matchSummary}
              onChange={(next) => {
                onChange({ ...stages, matchSummary: next });
              }}
            />
          ),
        },
        {
          id: "stage-2",
          title: "Stage 2: Review Text",
          content: (
            <StageConfigPanel
              type="review-text"
              title="Review Text"
              description="Generate the final review in the personality voice"
              stageName="reviewText"
              config={stages.reviewText}
              onChange={(next) => {
                onChange({ ...stages, reviewText: next });
              }}
            />
          ),
        },
        {
          id: "stage-3",
          title: "Stage 3: Image Description",
          content: (
            <StageConfigPanel
              type="toggleable"
              title="Image Description"
              description="Turn review text into an art direction prompt"
              stageName="imageDescription"
              config={stages.imageDescription}
              onChange={(next) => {
                onChange({ ...stages, imageDescription: next });
              }}
            />
          ),
        },
        {
          id: "stage-4",
          title: "Stage 4: Image Generation",
          content: (
            <ImageGenerationPanel
              config={stages.imageGeneration}
              onChange={(next) => {
                onChange({ ...stages, imageGeneration: next });
              }}
            />
          ),
        },
      ]}
    />
  );
}
