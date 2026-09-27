package com.shepherdjerred.thestorm.quests.app;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.quest;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.stage;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.board.Template;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEvent;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import com.shepherdjerred.thestorm.quests.domain.model.Faction;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Region;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The quest service with an in-memory store, a scripted world and recorded rewards. */
final class QuestServiceTest {

  static final UUID ALICE = new UUID(2, 1);
  static final UUID BOB = new UUID(2, 2);
  static final ItemMatch IRON = ItemMatch.of("IRON_INGOT");
  static final Instant WEDNESDAY = Instant.parse("2026-09-23T19:00:00Z");

  static final Quest SMITH =
      quest("smith")
          .giver("thomas")
          .stage(
              stage("gather")
                  .says("Ahah!")
                  .objective(new Objective.Deliver("thomas", IRON, 4, Optional.empty())))
          .reward(new Action.Crystals(100))
          .reward(new Action.Points(1))
          .reward(new Action.Reputation("town", 2))
          .reward(new Action.Title("smith"))
          .reward(new Action.Spell("blink"))
          .reward(new Action.Grant("custom.node"))
          .reward(new Action.Teleport("mines"))
          .reward(new Action.Spawn("ZOMBIE", 2, "mines", Optional.empty()))
          .reward(new Action.Give(ItemMatch.of("GOLD_INGOT"), 2))
          .reward(new Action.Message("Well done."))
          .reward(new Action.Custom("fanfare", "loud"))
          .build();

  static final Quest HUNT =
      quest("hunt")
          .giver("captain")
          .stage(stage("s").objective(new Objective.Kill("ZOMBIE", 2, Optional.empty())))
          .build();

  static final Template BOUNTY =
      new Template(
          "bounty",
          Template.Period.DAILY,
          Template.Kind.DELIVER,
          "Bounty: {amount} {target}",
          "Bring {amount}.",
          "Thanks.",
          "Later.",
          "Done.",
          10,
          List.of(new Template.Target("COD", 0.1, 2, 2, 1, 1)));

  private Fakes.Store store;
  private Fakes.World world;
  private Fakes.Rewards rewards;
  private Fakes.Clock clock;
  private QuestService service;

  static QuestsConfig config() {
    return new QuestsConfig(
        "America/Los_Angeles",
        "MONDAY",
        "world",
        new QuestsConfig.Budget(25, 100),
        new QuestsConfig.Party(24, 60),
        new QuestsConfig.BoardSettings("board", 1, 0),
        40,
        300,
        8,
        10,
        new QuestsConfig.Labels(
            "Accept", "Not now", "Hand over", "Back", "Goodbye", "What can I do for you?"));
  }

  @BeforeEach
  void start() {
    store = new Fakes.Store();
    world = new Fakes.World();
    rewards = new Fakes.Rewards();
    clock = new Fakes.Clock(WEDNESDAY);
    var content =
        new QuestContent(
            Catalog.of(List.of(SMITH, HUNT)).quests(),
            Map.of("town", new Faction("town", "Spawn Town", List.of())),
            Map.of(),
            Map.of("mines", new Region("mines", "Mines", "minecraft:overworld", 0, 64, 0, 10)),
            Map.of("fanfare", "plays a fanfare"),
            Map.of("bounty", BOUNTY),
            Map.of());
    service =
        new QuestService(
            new QuestService.Wiring(
                content,
                config(),
                store,
                world,
                rewards,
                npc -> npc.substring(0, 1).toUpperCase(java.util.Locale.ROOT) + npc.substring(1),
                Runnable::run,
                clock,
                new SplittableRandom(4),
                ComponentLogger.logger("test")));
  }

  private void join(UUID player) {
    world.join(player);
    service.join(player).join();
  }

  private PlayerQuests state(UUID player) {
    return service.state(player).orElseThrow();
  }

  @Test
  void joiningLoadsStateDrawsABoardAndShowsMarkers() {
    join(ALICE);
    var state = state(ALICE);
    assertThat(state.board().entries())
        .extracting(entry -> entry.slot())
        .containsExactly("daily-1");
    assertThat(store.saved).containsKey(ALICE);
    assertThat(world.markers.get(ALICE))
        .containsEntry("thomas", NpcMark.AVAILABLE)
        .containsEntry("captain", NpcMark.AVAILABLE)
        .containsEntry("board", NpcMark.AVAILABLE);
    assertThat(world.sidebars.get(ALICE)).isEmpty();
  }

  @Test
  void aPlayerWhoLeftBeforeLoadingIsNotKept() {
    service.join(ALICE).join();
    assertThat(service.state(ALICE)).isEmpty();
  }

  @Test
  void acceptingThroughAnNpcAndHandingInPaysEverything() {
    join(ALICE);
    service.accept(ALICE, "smith", "nat");
    assertThat(world.said(ALICE)).last().asString().contains("isn't offered here");
    service.accept(ALICE, "smith", "thomas");
    assertThat(state(ALICE).active("smith")).isPresent();
    assertThat(world.sidebars.get(ALICE)).isPresent();
    service.handIn(ALICE, "thomas", Optional.empty());
    assertThat(world.said(ALICE)).last().asString().contains("needs something you don't have yet");
    world.carry(ALICE).give(IRON, 4);
    assertThat(world.markers.get(ALICE)).containsEntry("thomas", NpcMark.NONE);
    service.tick();
    assertThat(world.markers.get(ALICE)).containsEntry("thomas", NpcMark.TURN_IN);
    service.handIn(ALICE, "thomas", Optional.of("smith"));
    assertThat(world.actions)
        .contains(
            "take 4 IRON_INGOT", "teleport mines", "spawn 2 ZOMBIE mines", "give 2 GOLD_INGOT");
    assertThat(rewards.paid).containsExactly("100 quest:smith");
    assertThat(rewards.granted)
        .containsExactly("thestorm.titles.smith", "thestorm.spells.learned.blink", "custom.node");
    assertThat(world.said(ALICE))
        .contains(
            "[Quests]: Handed over 4 Iron Ingot.",
            "[Thomas]: Ahah!",
            "[Thomas]: finish smith",
            "[Quests]: Quest complete: Quest smith",
            "[Quests]: +2 reputation with Spawn Town (2)",
            "[Quests]: +1 quest point (1)",
            "[Quests]: +100 crystals",
            "[Quests]: You earned the title Smith.",
            "[Quests]: You learned the Blink spell.",
            "[Quests]: Well done.");
    assertThat(store.saved.get(ALICE)).isEqualTo(state(ALICE));
    assertThat(state(ALICE).completion("smith")).isPresent();
  }

  @Test
  void aRefusedPaymentIsReported() {
    join(ALICE);
    rewards.refuse = true;
    service.accept(ALICE, "smith", "thomas");
    world.carry(ALICE).give(IRON, 4);
    service.handIn(ALICE, "thomas", Optional.empty());
    assertThat(world.said(ALICE)).contains("[Quests]: Your crystal reward could not be paid.");
  }

  @Test
  void customActionsRunTheRegisteredHandlerOnce() {
    service.onAction("fanfare", (player, argument) -> {});
    assertThatThrownBy(() -> service.onAction("fanfare", (player, argument) -> {}))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void killsAreSharedWithNearbyPlayersOnTheSameObjective() {
    join(ALICE);
    join(BOB);
    service.accept(ALICE, "hunt", "captain");
    service.accept(BOB, "hunt", "captain");
    service.event(ALICE, new QuestEvent.Killed("ZOMBIE"), List.of(BOB));
    assertThat(state(ALICE).active("hunt").orElseThrow().progress()).containsExactly(1);
    assertThat(state(BOB).active("hunt").orElseThrow().progress()).containsExactly(1);
    assertThat(world.actionBars.get(ALICE)).contains("Kill 2 Zombie  1/2");
    // Mining is not shared.
    service.event(ALICE, new QuestEvent.Mined("STONE"), List.of(BOB));
    service.event(ALICE, new QuestEvent.Killed("ZOMBIE"), List.of());
    assertThat(state(ALICE).completion("hunt")).isPresent();
    assertThat(state(BOB).active("hunt").orElseThrow().progress()).containsExactly(1);
  }

  @Test
  void trackingTogglesAndAbandoningDrops() {
    join(ALICE);
    service.accept(ALICE, "hunt", "captain");
    service.accept(ALICE, "smith", "thomas");
    assertThat(state(ALICE).tracked()).contains("hunt");
    service.track(ALICE, "smith");
    assertThat(state(ALICE).tracked()).contains("smith");
    service.track(ALICE, "smith");
    assertThat(state(ALICE).tracked()).isEmpty();
    assertThat(world.sidebars.get(ALICE)).isEmpty();
    service.track(ALICE, "nope");
    assertThat(world.said(ALICE)).last().asString().contains("don't have that quest");
    service.abandon(ALICE, "hunt");
    assertThat(state(ALICE).active("hunt")).isEmpty();
    service.abandon(ALICE, "hunt");
    assertThat(world.said(ALICE)).last().isEqualTo("[Quests]: You don't have that quest.");
  }

  @Test
  void theBoardIsOfferedAtTheBoardNpcAndExpiresAtMidnight() {
    join(ALICE);
    var dialogue = service.dialogue(ALICE, "board").orElseThrow();
    assertThat(dialogue.node(dialogue.start()).options().getFirst().choice())
        .isEqualTo(new QuestDialogue.Choice.Accept("daily-1"));
    service.accept(ALICE, "daily-1", "board");
    assertThat(state(ALICE).active("daily-1")).isPresent();
    clock.now = WEDNESDAY.plus(Duration.ofHours(12));
    service.tick();
    assertThat(state(ALICE).active("daily-1")).isEmpty();
    assertThat(state(ALICE).board().day()).isEqualTo("2026-09-24");
    assertThat(world.said(ALICE)).contains("[Quests]: Quest dropped: Bounty: 2 Cod");
  }

  @Test
  void journalProgressAndTopReadTheState() {
    join(ALICE);
    service.accept(ALICE, "hunt", "captain");
    var journal = service.journal(ALICE).orElseThrow();
    assertThat(journal.active()).containsExactly("hunt");
    assertThat(service.journal(BOB)).isEmpty();
    service.adminComplete(ALICE, "smith");
    assertThat(service.top().join()).containsExactly(new QuestStore.Standing(ALICE, 1));
    assertThat(service.content().quests()).containsKeys("smith", "hunt");
    assertThat(service.online()).containsExactly(ALICE);
    service.quit(ALICE);
    assertThat(service.online()).isEmpty();
  }

  @Test
  void administrationWorksOnOnlinePlayers() {
    join(ALICE);
    assertThat(service.adminStage(ALICE, "hunt", "s")).isEqualTo(Result.ok("Moved to s: hunt"));
    assertThat(state(ALICE).active("hunt")).isPresent();
    assertThat(service.adminStage(ALICE, "hunt", "zzz"))
        .isEqualTo(Result.err("That quest has no such stage."));
    assertThat(service.adminComplete(ALICE, "hunt")).isEqualTo(Result.ok("Completed hunt"));
    assertThat(state(ALICE).completion("hunt")).isPresent();
    assertThat(service.adminReset(ALICE, "hunt")).isEqualTo(Result.ok("Reset hunt"));
    assertThat(state(ALICE).completion("hunt")).isEmpty();
    assertThat(service.adminReset(ALICE, "ghost"))
        .isEqualTo(Result.err("There is no quest ghost."));
    assertThat(service.adminReset(BOB, "hunt").isOk()).isFalse();
  }

  @Test
  void generalActionsAcceptTheFirstOfferAndChooseRefusalsAreExplained() {
    join(ALICE);
    service.acceptFirst(ALICE, "thomas");
    assertThat(state(ALICE).active("smith")).isPresent();
    service.acceptFirst(ALICE, "thomas");
    assertThat(world.said(ALICE)).last().asString().contains("nothing to take on");
    service.choose(ALICE, "smith", 0);
    assertThat(world.said(ALICE)).last().asString().contains("nothing to decide");
  }

  @Test
  void refusalsReadWell() {
    for (var refusal :
        com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Refusal.values()) {
      assertThat(QuestService.refusal(refusal)).endsWith(".");
    }
  }
}
