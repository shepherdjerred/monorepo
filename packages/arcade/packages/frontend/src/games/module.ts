import type { ComponentType } from "react";
import type { GameDefinition } from "@arcade/common/catalog.ts";
import type { RoomSnapshot } from "@arcade/common/protocol.ts";
import type { Stats } from "@arcade/common/stats.ts";

export type GamePageProps = {
  readonly room: RoomSnapshot;
  readonly stats: Stats | undefined;
};

export type GameClientModule = {
  readonly definition: GameDefinition;
  readonly subtitle: string;
  readonly mark: string;
  readonly Page: ComponentType<GamePageProps>;
};
