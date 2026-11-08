import {
  defineCaptureSuite,
  type SuiteScenario,
} from "@shepherdjerred/mc-harness/capture/suite/define.ts";
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
import repair from "./scenes/mechanics/repair.ts";
import repairShots from "./presentations/mechanics/repair.ts";
import onboarding from "./scenes/essentials/onboarding.ts";
import onboardingShots from "./presentations/essentials/onboarding.ts";
import spells from "./scenes/progression/spells.ts";
import spellsShots from "./presentations/progression/spells.ts";
import stormnight from "./scenes/progression/stormnight.ts";
import stormnightShots from "./presentations/progression/stormnight.ts";
import travel from "./scenes/essentials/travel.ts";
import travelShots from "./presentations/essentials/travel.ts";
import shards from "./scenes/progression/shards.ts";
import shardShots from "./presentations/progression/shards.ts";
import quests from "./scenes/progression/quests.ts";
import questShots from "./presentations/progression/quests.ts";
import creative from "./scenes/worlds/creative.ts";
import creativeShots from "./presentations/worlds/creative.ts";
import bounce from "./scenes/mechanics/bounce.ts";
import bounceShots from "./presentations/mechanics/bounce.ts";
import arena from "./scenes/games/arena.ts";
import arenaShots from "./presentations/games/arena.ts";
import worldTour from "./scenes/worlds/world-tour.ts";
import worldTourShots from "./presentations/worlds/world-tour.ts";
import serverList from "./scenes/essentials/server-list.ts";
import serverListShots from "./presentations/essentials/server-list.ts";
import rwf from "./scenes/games/rwf.ts";
import rwfShots from "./presentations/games/rwf.ts";
import advancements from "./scenes/progression/advancements.ts";
import advancementShots from "./presentations/progression/advancements.ts";
import grave from "./scenes/mechanics/grave.ts";
import graveShots from "./presentations/mechanics/grave.ts";
import mail from "./scenes/essentials/mail.ts";
import mailShots from "./presentations/essentials/mail.ts";

export default defineCaptureSuite({
  id: "tsmc",
  legacyOutputs: [
    { shot: "grave-lava", path: "/screenshots/grave-lava.webp" },
    { shot: "rwf-kit-menu", path: "/screenshots/search-kits.webp" },
    { shot: "search-lobby", path: "/screenshots/search-lobby.webp" },
    { shot: "quest-board", path: "/screenshots/quest-board.webp" },
    {
      shot: "java-multiplayer-list",
      path: "/screenshots/java-multiplayer-list.webp",
    },
    {
      shot: "welcome-gate-selection",
      path: "/screenshots/welcome-gate-selection.webp",
    },
    { shot: "welcome-stargate", path: "/screenshots/welcome-stargate.webp" },
    { shot: "welcome-gate", path: "/demos/welcome-gate.mp4" },
    { shot: "skylands", path: "/screenshots/skylands.webp" },
    { shot: "spawn-town", path: "/screenshots/spawn-town.webp" },
    {
      shot: "historic-market-shop",
      path: "/screenshots/historic-market-shop.webp",
    },
    { shot: "mob-arena-classes", path: "/screenshots/mob-arena-classes.webp" },
    { shot: "creative-plot-claim", path: "/screenshots/creative-plot.webp" },
    { shot: "npc-quest-offer", path: "/screenshots/npc-quest-offer.webp" },
    { shot: "quest-field-note", path: "/screenshots/quest-journal.webp" },
    { shot: "shard-altar", path: "/screenshots/shard-altar.webp" },
    { shot: "claim-info", path: "/screenshots/claim-info.webp" },
    { shot: "sorting-settings", path: "/screenshots/sorting-settings.webp" },
    { shot: "lock-private", path: "/screenshots/lock-info.webp" },
    { shot: "shop-both-sign", path: "/screenshots/player-shop-sign.webp" },
    { shot: "spell-mark-info", path: "/screenshots/spell-mark-info.webp" },
    { shot: "welcome-guide", path: "/screenshots/welcome-guide.webp" },
    { shot: "worlds-menu", path: "/screenshots/worlds-menu.webp" },
    { shot: "cooking-pot", path: "/screenshots/cooking-pot.webp" },
    { shot: "deposit-bank", path: "/screenshots/deposit-bank-shelf.webp" },
    { shot: "skill-mining", path: "/screenshots/skill-mining.webp" },
  ],
  bootstrap: [68.5, 69, 66.5],
  patches: [
    { world: "world", min: [-128, -96], max: [304, 272], paddingChunks: 2 },
    { world: "creative", min: [-16, -16], max: [184, 92], paddingChunks: 2 },
    { world: "creative", min: [544, -16], max: [744, 92], paddingChunks: 2 },
    { world: "skylands", min: [-64, -64], max: [64, 64], paddingChunks: 2 },
    { world: "frontier", min: [-32, -32], max: [64, 32], paddingChunks: 2 },
    { world: "map2", min: [-32, -32], max: [32, 32], paddingChunks: 2 },
    { world: "rwf", min: [4096, 5120], max: [4190, 5310], paddingChunks: 2 },
    { world: "rwf_lobby", min: [0, 0], max: [177, 99], paddingChunks: 2 },
  ],
  features: ["stargates"],
  rollout: { url: "https://flipt.tailnet-1a49.ts.net", environment: "prod" },
  // Qualify the shared mechanics before booting the more expensive fresh venues.
  scenarios: (
    [
      {
        id: "mail",
        isolation: "fresh",
        scene: mail,
        shots: mailShots,
        anchor: [105, 81, 217],
        world: "world",
        helpers: [],
      },
      {
        id: "advancements",
        isolation: "fresh",
        siteMode: "preserve",
        features: ["advancements"],
        scene: advancements,
        shots: advancementShots,
        anchor: [71, 69, 69],
        world: "world",
        helpers: [],
      },
      {
        id: "grave",
        isolation: "fresh",
        scene: grave,
        shots: graveShots,
        anchor: [105, 81, 217],
        world: "world",
        helpers: [],
      },
      {
        id: "rwf",
        isolation: "fresh",
        siteMode: "preserve",
        features: ["rwf"],
        arrivalCommand: "rwf join",
        interactionSites: [
          {
            world: "rwf",
            min: { x: 4096, y: 0, z: 5120 },
            max: { x: 4190, y: 100, z: 5310 },
          },
        ],
        scene: rwf,
        shots: rwfShots,
        anchor: [34, 70, 34],
        world: "rwf_lobby",
        helpers: ["TsmcDemoHelper", "TsmcRedTwo", "TsmcBlueTwo"],
      },
      {
        id: "server-list",
        isolation: "fresh",
        clientUi: "server-list",
        siteMode: "preserve",
        scene: serverList,
        shots: serverListShots,
        anchor: [71, 69, 69],
        world: "world",
        helpers: [],
      },
      {
        id: "world-tour",
        isolation: "fresh",
        siteMode: "preserve",
        features: ["public-hub"],
        scene: worldTour,
        shots: worldTourShots,
        anchor: [12, 73, 116],
        world: "world",
        helpers: [],
      },
      {
        id: "arena",
        isolation: "fresh",
        siteMode: "preserve",
        features: ["arena"],
        scene: arena,
        shots: arenaShots,
        anchor: [227, 43, 3],
        world: "world",
        helpers: ["TsmcDemoHelper"],
      },
      {
        id: "bounce",
        isolation: "fresh",
        scene: bounce,
        shots: bounceShots,
        anchor: [105, 81, 217],
        world: "world",
        helpers: ["TsmcDemoHelper"],
      },
      {
        id: "creative",
        arrivalCommand: "creative",
        isolation: "fresh",
        siteMode: "preserve",
        scene: creative,
        shots: creativeShots,
        anchor: [583, 65, 23],
        world: "creative",
        helpers: ["TsmcDemoHelper"],
      },
      {
        id: "quests",
        isolation: "fresh",
        siteMode: "preserve",
        features: ["quests"],
        scene: quests,
        shots: questShots,
        anchor: [-44, 70, 27],
        world: "world",
        helpers: [],
      },
      {
        id: "shards",
        isolation: "fresh",
        siteMode: "preserve",
        features: ["shards"],
        scene: shards,
        shots: shardShots,
        anchor: [75, 69, 69],
        world: "world",
        helpers: [],
      },
      {
        id: "travel",
        isolation: "fresh",
        scene: travel,
        shots: travelShots,
        anchor: [105, 81, 217],
        world: "world",
        helpers: ["TsmcDemoHelper"],
      },
      {
        id: "stormnight",
        isolation: "fresh",
        siteMode: "preserve",
        features: ["stormnight"],
        scene: stormnight,
        shots: stormnightShots,
        anchor: [71, 69, 69],
        world: "world",
        helpers: [],
      },
      {
        id: "spells",
        isolation: "fresh",
        scene: spells,
        shots: spellsShots,
        anchor: [105, 81, 217],
        world: "world",
        helpers: [],
      },
      {
        id: "onboarding",
        isolation: "fresh",
        siteMode: "preserve",
        features: ["public-hub"],
        scene: onboarding,
        shots: onboardingShots,
        anchor: [71, 69, 69],
        world: "world",
        helpers: [],
      },
      {
        id: "repair",
        isolation: "fresh",
        scene: repair,
        shots: repairShots,
        anchor: [105, 81, 217],
        world: "world",
        helpers: [],
      },
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
        helpers: ["TsmcDemoHelper"],
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
    ] satisfies SuiteScenario[]
  ).toSorted(
    (left, right) =>
      Number(left.isolation === "fresh") - Number(right.isolation === "fresh"),
  ),
});
