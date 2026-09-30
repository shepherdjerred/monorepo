package com.shepherdjerred.thestorm.quests.domain.content;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.always;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.quest;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.stage;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.talk;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.when;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.quests.domain.board.Template;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig.Budget;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.Faction;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Region;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class ContentCheckTest {

  static final ContentRegistry REGISTRY =
      new ContentRegistry(
          Set.of("giver", "thomas", "board"),
          Set.of("IRON_INGOT", "DIAMOND_SWORD", "POTION", "COD"),
          Set.of("STONE", "TORCH"),
          Set.of("ZOMBIE", "SKELETON"),
          Set.of("minecraft:overworld"),
          Set.of("mechanic"),
          Set.of("sharpness"),
          Set.of("healing"));

  static final ContentCheck.Rules RULES =
      new ContentCheck.Rules(REGISTRY, new Budget(10, 50), "board", "minecraft:overworld");

  private static QuestContent content(Quest... quests) {
    return new QuestContent(
        Catalog.of(List.of(quests)).quests(),
        Map.of("town", new Faction("town", "Town", List.of())),
        Map.of("x", "a variable", "unset", "never set"),
        Map.of("mines", new Region("mines", "Mines", "minecraft:overworld", 0, 64, 0, 10)),
        Map.of("wave", "arena waves"),
        Map.of(),
        Map.of());
  }

  private static List<String> messages(QuestContent content) {
    return ContentCheck.problems(content, RULES).stream().map(ContentProblem::message).toList();
  }

  private static Quest simple(Objective objective) {
    return quest("q").stage(stage("s").objective(objective)).build();
  }

  @Test
  void aCleanQuestHasNoProblems() {
    var quest =
        quest("q")
            .giver("thomas")
            .requires(new Condition.Compare("x", Condition.Comparison.GREATER, 0))
            .stage(
                stage("s")
                    .objective(
                        new Objective.Deliver(
                            "thomas", ItemMatch.of("IRON_INGOT"), 2, Optional.empty()))
                    .onComplete(new Action.SetVariable("x", 1)))
            .reward(new Action.Crystals(100))
            .build();
    assertThat(messages(content(quest))).isEmpty();
  }

  @Test
  void everyReferenceMustExist() {
    var bad =
        quest("q")
            .giver("nobody")
            .requires(new Condition.Completed("ghost"))
            .requires(new Condition.ReputationAtLeast("cult", 1))
            .requires(new Condition.InRegion("moon"))
            .requires(new Condition.TrackAtLeast("wizard", 6))
            .stage(
                stage("s")
                    .objective(new Objective.Talk("nobody", Optional.empty()))
                    .objective(new Objective.Hold(ItemMatch.of("RAW_FISH"), 1, Optional.empty()))
                    .objective(
                        new Objective.Hold(
                            new ItemMatch(
                                "DIAMOND_SWORD",
                                Optional.empty(),
                                Map.of("smite", 1),
                                Optional.empty()),
                            1,
                            Optional.empty()))
                    .objective(
                        new Objective.Hold(
                            new ItemMatch(
                                "POTION", Optional.empty(), Map.of(), Optional.of("flying")),
                            1,
                            Optional.empty()))
                    .objective(new Objective.Mine("IRON_INGOT", 1, Optional.empty()))
                    .objective(new Objective.Kill("PIG_ZOMBIE", 1, Optional.empty()))
                    .objective(new Objective.Custom("cutscene", 1, Optional.empty()))
                    .onComplete(new Action.Spawn("DRAGON", 1, "moon", Optional.empty()))
                    .onComplete(new Action.StartQuest("ghost"))
                    .onComplete(new Action.AddVariable("undeclared", 1))
                    .onComplete(new Action.Title("Bad Title")))
            .build();
    assertThat(messages(content(bad)))
        .contains(
            "NPC nobody does not exist",
            "quest ghost does not exist",
            "faction cult does not exist",
            "region moon does not exist",
            "track wizard does not exist",
            "tracks go up to level 5",
            "RAW_FISH is not an item",
            "enchantment smite does not exist",
            "potion type flying does not exist",
            "IRON_INGOT is not a block",
            "PIG_ZOMBIE is not a creature",
            "hook cutscene is not declared under hooks",
            "DRAGON cannot be spawned",
            "variable undeclared is not declared under variables");
    assertThat(messages(content(bad))).anyMatch(message -> message.startsWith("title ids"));
  }

  @Test
  void killingPlayersIsNotAnObjective() {
    assertThat(messages(content(simple(new Objective.Kill("PLAYER", 5, Optional.empty())))))
        .contains("killing players is not a quest objective");
  }

  @Test
  void variablesReadButNeverSetAreProblems() {
    var quest =
        quest("q")
            .requires(new Condition.Compare("unset", Condition.Comparison.EQUAL, 1))
            .stage(stage("s").objective(talk("giver")))
            .build();
    assertThat(messages(content(quest)))
        .contains("variable unset is read but no action ever sets it");
  }

  @Test
  void theStatechartMustReachCompletion() {
    var unreachable =
        quest("q")
            .stage(stage("a").objective(talk("giver")))
            .stage(stage("orphan").objective(talk("giver")))
            .start("a")
            .build();
    assertThat(messages(content(unreachable))).contains("stage orphan can never be reached from a");
    var deadEnd =
        quest("q")
            .stage(stage("a").objective(talk("giver")).branches(always("b"), always("complete")))
            .stage(stage("b").objective(talk("giver")).then("fail"))
            .start("a")
            .build();
    assertThat(messages(content(deadEnd))).contains("stage b can never lead to completion");
    var missing = quest("q").stage(stage("a").objective(talk("giver")).then("nowhere")).build();
    assertThat(messages(content(missing)))
        .contains("stage a leads to nowhere, which does not exist");
    var noStart = quest("q").stage(stage("a").objective(talk("giver"))).start("zzz").build();
    assertThat(messages(content(noStart))).contains("start stage zzz does not exist");
    var timeoutOnly =
        quest("q")
            .stage(
                stage("a")
                    .objective(talk("giver"))
                    .then("fail")
                    .limit(new Stage.TimeLimit(Duration.ofMinutes(1), "complete")))
            .build();
    assertThat(messages(content(timeoutOnly))).contains("stage a can never lead to completion");
  }

  @Test
  void loopsWithoutObjectivesAreProblemsButChoiceLoopsAreFine() {
    var spin =
        quest("q")
            .stage(
                stage("a").branches(when("b", new Condition.PointsAtLeast(1)), always("complete")))
            .stage(stage("b").then("a"))
            .start("a")
            .build();
    assertThat(messages(content(spin)))
        .anyMatch(message -> message.contains("loop back to itself"));
    var retry =
        quest("q")
            .stage(
                stage("a")
                    .objective(talk("giver"))
                    .choice(new Stage.Option("Again", "a"), new Stage.Option("Done", "complete")))
            .build();
    assertThat(messages(content(retry))).isEmpty();
  }

  @Test
  void rewardsMustFitTheBudgetAlongTheRichestPath() {
    // Budget: 50 + 10 per minute; ten minutes allows 150.
    var fits =
        quest("q")
            .minutes(10)
            .stage(stage("s").objective(talk("giver")))
            .reward(new Action.Crystals(150))
            .build();
    assertThat(messages(content(fits))).isEmpty();
    var branchy =
        quest("q")
            .minutes(10)
            .stage(
                stage("a")
                    .objective(talk("giver"))
                    .choice(new Stage.Option("Rich", "rich"), new Stage.Option("Poor", "complete")))
            .stage(stage("rich").onComplete(new Action.Crystals(101)))
            .start("a")
            .onAccept(new Action.Crystals(10))
            .reward(new Action.Crystals(40))
            .build();
    assertThat(messages(content(branchy)))
        .contains("pays up to 151 crystals, over the budget of 150 for 10 minutes");
  }

  @Test
  void objectiveGatedLoopsCannotPayCrystalsRepeatedly() {
    var repeatable =
        quest("q")
            .minutes(10)
            .stage(
                stage("a")
                    .objective(talk("giver"))
                    .onComplete(new Action.Crystals(10))
                    .choice(new Stage.Option("Again", "b"), new Stage.Option("Done", "complete")))
            .stage(stage("b").objective(talk("giver")).then("a"))
            .build();
    assertThat(messages(content(repeatable)))
        .contains("stage a pays crystals in a repeatable cycle; rewards must fit a finite budget");
  }

  @Test
  void textMustFitTheDialogs() {
    var longJournal =
        new Quest(
            "q",
            "x".repeat(49),
            "giver",
            Quest.Category.SIDE,
            Quest.Repeat.ONCE,
            5,
            List.of(),
            new Quest.QuestText(
                "o".repeat(601),
                "a",
                "d",
                "f",
                "s",
                List.of(
                    new Quest.Question("q".repeat(33), "a"),
                    new Quest.Question("b", "a"),
                    new Quest.Question("c", "a"),
                    new Quest.Question("d", "a"))),
            "s",
            Map.of(
                "s",
                stage("s")
                    .objective(new Objective.Talk("giver", Optional.of("l".repeat(41))))
                    .build()),
            List.of(),
            List.of(new Action.Message(" ")));
    assertThat(messages(content(longJournal)))
        .contains(
            "name must be 1..48 characters (is 49)",
            "text.offer must be 1..600 characters (is 601)",
            "at most 3 questions fit beside Accept and Decline",
            "text.questions.label must be 1..32 characters (is 33)",
            "objective text must be 1..40 characters (is 41)",
            "message must be 1..600 characters (is 1)");
  }

  @Test
  void dailyQuestsMustRepeatAndRequirementsCannotCycle() {
    var daily =
        quest("d")
            .category(Quest.Category.DAILY)
            .stage(stage("s").objective(talk("giver")))
            .build();
    assertThat(messages(content(daily))).contains("daily and weekly quests must repeat");
    var a =
        quest("a")
            .requires(new Condition.Completed("b"))
            .stage(stage("s").objective(talk("giver")))
            .build();
    var b =
        quest("b")
            .requires(new Condition.Completed("a"))
            .stage(stage("s").objective(talk("giver")))
            .build();
    assertThat(messages(content(a, b)))
        .filteredOn(message -> message.contains("requires completing itself"))
        .hasSize(2);
    var self =
        quest("s")
            .stage(stage("s").objective(talk("giver")).onComplete(new Action.StartQuest("s")))
            .build();
    assertThat(messages(content(self))).contains("a quest cannot start itself");
  }

  @Test
  void theBoardNpcAndRegionWorldsMustExist() {
    var rules =
        new ContentCheck.Rules(REGISTRY, new Budget(10, 50), "nobody", "minecraft:overworld");
    var content =
        new QuestContent(
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of("far", new Region("far", "Far", "minecraft:the_end", 0, 0, 0, 5)),
            Map.of(),
            Map.of(),
            Map.of());
    assertThat(ContentCheck.problems(content, rules))
        .extracting(ContentProblem::message)
        .contains("board NPC nobody does not exist", "world minecraft:the_end is not loaded");
  }

  @Test
  void aLoadedWorldOutsideTheMainWorldIsRejected() {
    var registry =
        new ContentRegistry(
            REGISTRY.npcs(),
            REGISTRY.items(),
            REGISTRY.blocks(),
            REGISTRY.entities(),
            Set.of("minecraft:overworld", "minecraft:the_nether"),
            REGISTRY.tracks(),
            REGISTRY.enchantments(),
            REGISTRY.potions());
    var rules =
        new ContentCheck.Rules(registry, new Budget(10, 50), "board", "minecraft:overworld");
    var content =
        new QuestContent(
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of("nether", new Region("nether", "Nether", "minecraft:the_nether", 0, 64, 0, 5)),
            Map.of(),
            Map.of(),
            Map.of());
    assertThat(ContentCheck.problems(content, rules))
        .extracting(ContentProblem::message)
        .contains("world minecraft:the_nether is outside the main world")
        .doesNotContain("world minecraft:the_nether is not loaded");
  }

  @Test
  void boardTemplatesAreCheckedAtBothEndsOfEveryRow() {
    var template =
        new Template(
            "t",
            Template.Period.DAILY,
            Template.Kind.KILL,
            "A very long bounty name for {amount} {target} indeed ok",
            "offer",
            "accept",
            "decline",
            "finish",
            100,
            List.of(
                new Template.Target("ZOMBIE", 1, 1, 50, 20, 0.1),
                new Template.Target("PLAYER", 1, 1, 2, 1, 1)));
    var content =
        new QuestContent(
            Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of("t", template), Map.of());
    var found =
        ContentCheck.problems(content, RULES).stream().map(ContentProblem::message).toList();
    assertThat(found).contains("killing players is not a quest objective");
    assertThat(found).anyMatch(message -> message.startsWith("ZOMBIE x50 pays"));
    assertThat(found).anyMatch(message -> message.contains("1..48"));
  }

  @Test
  void overflowingBoardNumbersReportTheirSourceAndKeepLinting() {
    var template =
        new Template(
            "overflow",
            Template.Period.DAILY,
            Template.Kind.KILL,
            "Bounty {target}",
            "offer",
            "accept",
            "decline",
            "finish",
            0,
            List.of(
                new Template.Target("ZOMBIE", 1, 2, 2, Long.MAX_VALUE, 1),
                new Template.Target("PLAYER", 1, 1, 1, 1, 1)));
    var content =
        new QuestContent(
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of("overflow", template),
            Map.of("overflow", "quests/board/overflow.yml"));

    assertThat(ContentCheck.problems(content, RULES))
        .contains(
            new ContentProblem(
                "quests/board/overflow.yml",
                "templates.overflow",
                "ZOMBIE x2 has invalid board numbers: long overflow"))
        .extracting(ContentProblem::message)
        .contains("killing players is not a quest objective");
  }
}
