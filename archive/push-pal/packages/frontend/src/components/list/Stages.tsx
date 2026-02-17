import type { Stages } from "../../types/Stage";
import Promote from "./Promote";
import Stage from "./Stage";

export type StagesProps = {
  stages: Stages;
};

export default function Stages({ stages }: StagesProps) {
  const showPromoteButton = stages.main.revision !== stages.prod.revision;

  return (
    <>
      <Stage stage={stages.main} />
      {showPromoteButton && <Promote />}
      <Stage stage={stages.prod} />
    </>
  );
}
