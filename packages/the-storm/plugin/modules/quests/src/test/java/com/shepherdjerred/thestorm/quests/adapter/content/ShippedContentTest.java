package com.shepherdjerred.thestorm.quests.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.quests.domain.board.BoardQuests;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.sim.Simulator;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

/**
 * The quest content the repository ships: it passes the linter against the shipped NPCs and the
 * real registries, and the simulator plays every quest (and board quests from every template)
 * through to completion with the rewards it promises.
 */
final class ShippedContentTest {

  private static final Instant NOW = Instant.parse("2026-09-23T19:00:00Z");

  /** The 2017 quests ported to the launch content, by id. */
  static final List<String> PORTED =
      List.of(
          "a-blacksmiths-task",
          "a-thoughtful-gift",
          "teach-a-man-to-fish",
          "from-ingots-to-rails",
          "nurturing-growth",
          "a-wizards-study",
          "somethings-fishy",
          "insomnia",
          "troubles-brewing",
          "ready-for-battle",
          "fuel-to-the-fire",
          "without-a-home",
          "gearing-up",
          "cades-cheese-fetish",
          "out-fishing",
          "an-enchanting-errand",
          "a-shady-request",
          "the-south-mines",
          "a-cold-winter",
          "alchemy-and-metallurgy",
          "for-science",
          "boberts-request",
          "daily-login");

  /** Two linked quests from each of the first eight regional anthologies. */
  static final List<String> REGIONAL =
      List.of(
          "the-windmills-shadow",
          "the-mill-register",
          "clearing-the-sewers",
          "braxtons-audit",
          "researching-infinite-water",
          "unshelved",
          "broken-axle",
          "caravan-conundrums",
          "edge-of-the-wilds",
          "rain-on-the-trail",
          "lamps-for-dorran",
          "a-vein-worth-mapping",
          "nets-and-knots",
          "harbour-lights",
          "frost-falls-record",
          "the-last-hearth");

  private static QuestContent content = QuestContent.empty();

  @BeforeAll
  static void load() {
    MockBukkit.mock();
    content = ShippedContent.load();
  }

  @AfterAll
  static void stop() {
    MockBukkit.unmock();
  }

  @Test
  void theShippedContentPassesTheLinter() {
    assertThat(content.quests().keySet())
        .containsExactlyInAnyOrderElementsOf(
            Stream.concat(
                    Stream.concat(PORTED.stream(), Stream.of("the-gate-ledger")), REGIONAL.stream())
                .toList());
    assertThat(content.factions()).containsOnlyKeys("townsfolk", "storm-watch");
    assertThat(content.templates()).isNotEmpty();
  }

  @Test
  void thePvpAndStubQuestsAreNotShipped() {
    assertThat(content.quests())
        .doesNotContainKeys(
            "a-laymans-guide-to-murder", "nether-expedition", "testriot", "revenge");
    assertThat(content.regions().values())
        .allSatisfy(region -> assertThat(region.world()).isEqualTo(ShippedContent.OVERWORLD));
    for (var quest : content.quests().values()) {
      for (var stage : quest.stages().values()) {
        assertThat(stage.objectives())
            .noneMatch(
                objective ->
                    objective instanceof Objective.Kill(var entity, _, _)
                        && "PLAYER".equals(entity));
      }
    }
  }

  @Test
  void everyShippedQuestCompletesInTheSimulatorAndPaysWhatItPromises() {
    var catalog = content.catalog();
    for (var quest : catalog.all()) {
      var runs = Simulator.simulate(catalog, quest, ShippedContent.config().calendar(), NOW);
      assertThat(runs).as(quest.id()).isNotEmpty();
      for (var run : runs) {
        assertThat(run.completed())
            .as("%s: %s", quest.id(), String.join("\n", run.transcript()))
            .isTrue();
        assertThat(run.crystals()).as(quest.id()).isGreaterThanOrEqualTo(crystals(quest.rewards()));
      }
    }
  }

  @Test
  void boardQuestsFromEveryTemplateAndTargetComplete() {
    var config = ShippedContent.config();
    for (var template : content.templates().values()) {
      for (var seed = 0L; seed < 40; seed++) {
        var quest =
            BoardQuests.quest(
                template,
                BoardQuests.entry("daily-1", template, BoardQuests.draw(template, seed)),
                config.board().npc());
        var runs = Simulator.simulate(Catalog.of(List.of(quest)), quest, config.calendar(), NOW);
        assertThat(runs)
            .as("%s seed %s", template.id(), seed)
            .allSatisfy(run -> assertThat(run.completed()).isTrue());
        assertThat(quest.name().length()).isLessThanOrEqualTo(48);
      }
    }
  }

  @Test
  void theFixedBugsStayFixed() {
    var gift = content.catalog().require("a-thoughtful-gift");
    // 2017: the opening line ran the stage-3 events. Now each stage asks for its own flowers.
    assertThat(stageOrder(gift))
        .containsExactly("dandelions", "sunflowers", "red-tulips", "orange-tulips", "rose-bushes");
    // 2017: the journal kept BetonQuest's sample translations. Now it is one English line.
    assertThat(gift.stage("dandelions").orElseThrow().journal())
        .isEqualTo("You decide to give 6 dandelions to Nat.");
    // 2017: Marcus's wood and iron hand-ins were swapped. Now each counts its own item.
    var rails = content.catalog().require("from-ingots-to-rails");
    assertThat(rails.stage("materials").orElseThrow().objectives())
        .extracting(objective -> ((Objective.Deliver) objective).item().material())
        .containsExactly("IRON_INGOT", "OAK_LOG");
    // 2017: An Enchanting Errand required the PvP quest, which is not shipped.
    var errand = content.catalog().require("an-enchanting-errand");
    assertThat(errand.requirements())
        .containsExactly(new Condition.Completed("a-blacksmiths-task"));
  }

  @Test
  void theGateLedgerKeepsBothConsequences() {
    var ledger = content.catalog().require("the-gate-ledger");
    var runs =
        Simulator.simulate(content.catalog(), ledger, ShippedContent.config().calendar(), NOW);
    assertThat(runs).hasSize(2).allSatisfy(run -> assertThat(run.completed()).isTrue());
    assertThat(ledger.stage("accuse").orElseThrow().onComplete())
        .contains(new Action.SetVariable("gate-ledger-outcome", 1));
    assertThat(ledger.stage("trace").orElseThrow().onComplete())
        .contains(new Action.SetVariable("gate-ledger-outcome", 2));
  }

  @Test
  void unshelvedReturnsTheSherdAfterWalterCopiesIt() {
    var unshelved = content.catalog().require("unshelved");
    assertThat(unshelved.rewards())
        .contains(new Action.Give(ItemMatch.of("ANGLER_POTTERY_SHERD"), 1));
  }

  @Test
  void legacyNamesAreRejected() {
    // The linter checks against 26.2's registries, where 1.11 names do not exist.
    var registry = ShippedContent.registry();
    assertThat(registry.items())
        .doesNotContain("RAW_FISH", "INK_SACK", "POTATO_ITEM", "SKULL_ITEM");
    assertThat(registry.items()).contains("COD", "TROPICAL_FISH", "COCOA_BEANS", "POTATO");
    assertThat(registry.entities()).doesNotContain("PIG_ZOMBIE").contains("ZOMBIFIED_PIGLIN");
  }

  private static List<String> stageOrder(Quest quest) {
    var order = new ArrayList<String>();
    var id = quest.start();
    while (!"complete".equals(id)) {
      order.add(id);
      id = quest.stage(id).orElseThrow().next().targets().getFirst();
    }
    return order;
  }

  private static long crystals(List<Action> actions) {
    return actions.stream()
        .flatMap(
            action ->
                action instanceof Action.Crystals(var amount) ? Stream.of(amount) : Stream.of())
        .mapToLong(Long::longValue)
        .sum();
  }
}
