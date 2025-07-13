import type { Stage } from "../../types/Stage";

export type StageProps = {
  stage: Stage;
};

export default function Stage({ stage }: StageProps) {
  return (
    <>
      <div>
        <h4>
          {stage.name} at {stage.revision}
        </h4>
      </div>
    </>
  );
}
