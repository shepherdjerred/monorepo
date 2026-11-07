import { defineCaptureSuite } from "@shepherdjerred/mc-harness/capture/suite/define.ts";
import bank from "./scenes/bank.ts";
import bankShots from "./presentations/bank.ts";
import bridge from "./scenes/bridge.ts";
import bridgeShots from "./presentations/bridge.ts";
import camp from "./scenes/camp.ts";
import campShots from "./presentations/camp.ts";
import commandGuides from "./scenes/command-guides.ts";
import commandGuidesShots from "./presentations/command-guides.ts";
import cooking from "./scenes/cooking.ts";
import cookingShots from "./presentations/cooking.ts";
import customerShops from "./scenes/customer-shops.ts";
import customerShopsShots from "./presentations/customer-shops.ts";
import door from "./scenes/door.ts";
import doorShots from "./presentations/door.ts";
import elevator from "./scenes/elevator.ts";
import elevatorShots from "./presentations/elevator.ts";
import gate from "./scenes/gate.ts";
import gateShots from "./presentations/gate.ts";
import locks from "./scenes/locks.ts";
import locksShots from "./presentations/locks.ts";
import painting from "./scenes/painting.ts";
import paintingShots from "./presentations/painting.ts";
import pistons from "./scenes/pistons.ts";
import pistonsShots from "./presentations/pistons.ts";
import signCopy from "./scenes/sign-copy.ts";
import signCopyShots from "./presentations/sign-copy.ts";
import sorting from "./scenes/sorting.ts";
import sortingShots from "./presentations/sorting.ts";
import stargates from "./scenes/stargates.ts";
import stargatesShots from "./presentations/stargates.ts";
import switches from "./scenes/switches.ts";
import switchesShots from "./presentations/switches.ts";
import town from "./scenes/town.ts";
import townShots from "./presentations/town.ts";

export default defineCaptureSuite({
  id: "tsmc",
  patches: [
    { world: "world", min: [64, 160], max: [160, 256], paddingChunks: 12 },
    { world: "creative", min: [-16, -16], max: [92, 92], paddingChunks: 12 },
  ],
  features: ["stargates"],
  rollout: { url: "https://flipt.tailnet-1a49.ts.net", environment: "prod" },
  scenarios: [
    {
      id: "bank",
      scene: bank,
      shots: bankShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "bridge",
      scene: bridge,
      shots: bridgeShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "camp",
      scene: camp,
      shots: campShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "command-guides",
      scene: commandGuides,
      shots: commandGuidesShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "cooking",
      scene: cooking,
      shots: cookingShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "customer-shops",
      scene: customerShops,
      shots: customerShopsShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: ["TsmcDemoHelper"],
    },
    {
      id: "door",
      scene: door,
      shots: doorShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "elevator",
      scene: elevator,
      shots: elevatorShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "gate",
      scene: gate,
      shots: gateShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "locks",
      scene: locks,
      shots: locksShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "painting",
      scene: painting,
      shots: paintingShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "pistons",
      scene: pistons,
      shots: pistonsShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "sign-copy",
      scene: signCopy,
      shots: signCopyShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "sorting",
      scene: sorting,
      shots: sortingShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "stargates",
      scene: stargates,
      shots: stargatesShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "switches",
      scene: switches,
      shots: switchesShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: [],
    },
    {
      id: "town",
      scene: town,
      shots: townShots,
      anchor: [105, 81, 217],
      world: "world",
      helpers: ["TsmcDemoHelper"],
    },
  ],
});
