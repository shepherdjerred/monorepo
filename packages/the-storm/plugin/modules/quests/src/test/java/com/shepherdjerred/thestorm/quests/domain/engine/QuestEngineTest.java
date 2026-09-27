package com.shepherdjerred.thestorm.quests.domain.engine;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.accepted;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.always;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.context;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.empty;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.ok;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.quest;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.refused;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.stage;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.talk;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.when;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.quests.domain.Fixtures;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Availability;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Refusal;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.ItemFacts;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import com.shepherdjerred.thestorm.quests.domain.sim.ScriptedFacts;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest.Phase;
import com.shepherdjerred.thestorm.quests.domain.state.Completion;
import java.time.Duration;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class QuestEngineTest {

  private static final ItemMatch IRON = ItemMatch.of("IRON_INGOT");
  private final ScriptedFacts facts = new ScriptedFacts();

  private static Objective kill(String entity, int amount) {
    return new Objective.Kill(entity, amount, Optional.empty());
  }

  private static Objective deliver(String npc, ItemMatch item, int amount) {
    return new Objective.Deliver(npc, item, amount, Optional.empty());
  }

  // ---- accepting ---------------------------------------------------------------------------

  @Test
  void acceptingEntersTheStartStageTracksItAndGreets() {
    var quest = quest("hunt").stage(stage("one").objective(kill("ZOMBIE", 2))).build();
    var outcome = ok(QuestEngine.accept(empty(), "hunt", context(facts, quest)));
    var active = outcome.state().active("hunt").orElseThrow();
    assertThat(active.stage()).isEqualTo("one");
    assertThat(active.progress()).containsExactly(0);
    assertThat(active.phase()).isEqualTo(Phase.IN_PROGRESS);
    assertThat(active.startedAt()).isEqualTo(Fixtures.NOW);
    assertThat(outcome.state().tracked()).contains("hunt");
    assertThat(outcome.effects())
        .containsSubsequence(
            new Effect.Accepted("hunt"),
            new Effect.Say("giver", "accept hunt"),
            new Effect.StageStarted("hunt", "one"));
  }

  @Test
  void acceptingASecondQuestKeepsTheFirstTracked() {
    var first = quest("first").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var second = quest("second").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var context = context(facts, first, second);
    var state = accepted(accepted(empty(), "first", context), "second", context);
    assertThat(state.tracked()).contains("first");
  }

  @Test
  void refusalsExplainWhy() {
    var locked =
        quest("locked")
            .requires(new Condition.Completed("other"))
            .stage(stage("s").objective(kill("ZOMBIE", 1)))
            .build();
    var once = quest("once").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var context = context(facts, locked, once);
    assertThat(refused(QuestEngine.accept(empty(), "nope", context)))
        .isEqualTo(Refusal.UNKNOWN_QUEST);
    assertThat(refused(QuestEngine.accept(empty(), "locked", context)))
        .isEqualTo(Refusal.REQUIREMENTS_UNMET);
    var taken = accepted(empty(), "once", context);
    assertThat(refused(QuestEngine.accept(taken, "once", context)))
        .isEqualTo(Refusal.ALREADY_ACTIVE);
    var done = empty().withCompletion("once", new Completion(1, Fixtures.NOW));
    assertThat(refused(QuestEngine.accept(done, "once", context)))
        .isEqualTo(Refusal.NOT_REPEATABLE_YET);
  }

  @Test
  void availabilityReflectsState() {
    var quest =
        quest("q")
            .requires(new Condition.PointsAtLeast(2))
            .stage(stage("s").objective(kill("ZOMBIE", 1)))
            .build();
    var context = context(facts, quest);
    assertThat(QuestEngine.availability(empty(), quest, context)).isEqualTo(Availability.LOCKED);
    var ready = empty().withPoints(2);
    assertThat(QuestEngine.availability(ready, quest, context)).isEqualTo(Availability.OFFERABLE);
    var active = accepted(ready, "q", context);
    assertThat(QuestEngine.availability(active, quest, context)).isEqualTo(Availability.ACTIVE);
    var done = ready.withCompletion("q", new Completion(1, Fixtures.NOW));
    assertThat(QuestEngine.availability(done, quest, context)).isEqualTo(Availability.DONE);
  }

  @Test
  void onAcceptActionsRunBeforeTheFirstStage() {
    var quest =
        quest("kit")
            .onAccept(new Action.Give(IRON, 3))
            .onAccept(new Action.SetVariable("met", 1))
            .stage(stage("s").objective(kill("ZOMBIE", 1)))
            .build();
    var outcome = ok(QuestEngine.accept(empty(), "kit", context(facts, quest)));
    assertThat(outcome.effects()).contains(new Effect.World("kit", new Action.Give(IRON, 3)));
    assertThat(outcome.state().variable("met")).isEqualTo(1);
  }

  // ---- counting events ---------------------------------------------------------------------

  @Test
  void killsCountUpToTheRequiredAmountThenTheQuestCompletes() {
    var quest =
        quest("hunt")
            .stage(stage("one").objective(kill("ZOMBIE", 2)))
            .reward(new Action.Crystals(50))
            .build();
    var context = context(facts, quest);
    var state = accepted(empty(), "hunt", context);
    var first = QuestEngine.handle(state, new QuestEvent.Killed("ZOMBIE"), context);
    assertThat(first.state().active("hunt").orElseThrow().progress()).containsExactly(1);
    assertThat(first.effects()).containsExactly(new Effect.Progressed("hunt", "one", 0, 1, 2));
    var other = QuestEngine.handle(first.state(), new QuestEvent.Killed("SKELETON"), context);
    assertThat(other.effects()).isEmpty();
    var second = QuestEngine.handle(first.state(), new QuestEvent.Killed("ZOMBIE"), context);
    assertThat(second.state().active("hunt")).isEmpty();
    assertThat(second.state().completion("hunt")).contains(new Completion(1, Fixtures.NOW));
    assertThat(second.effects())
        .contains(
            new Effect.Say("giver", "finish hunt"),
            new Effect.Completed("hunt"),
            new Effect.World("hunt", new Action.Crystals(50)));
    assertThat(second.state().tracked()).isEmpty();
  }

  @Test
  void countsAreCappedAtTheRequiredAmount() {
    var quest =
        quest("pick")
            .stage(
                stage("s")
                    .objective(new Objective.Collect(IRON, 5, Optional.empty()))
                    .objective(kill("ZOMBIE", 1)))
            .build();
    var context = context(facts, quest);
    var state = accepted(empty(), "pick", context);
    var outcome =
        QuestEngine.handle(
            state, new QuestEvent.Collected(ItemFacts.of("IRON_INGOT"), 64), context);
    assertThat(outcome.state().active("pick").orElseThrow().progress()).containsExactly(5, 0);
  }

  @Test
  void eventsOnlyCountForQuestsInProgress() {
    var quest =
        quest("pick")
            .stage(
                stage("s").objective(kill("ZOMBIE", 1)).choice(new Stage.Option("A", "complete")))
            .build();
    var context = context(facts, quest);
    var state =
        QuestEngine.handle(
                accepted(empty(), "pick", context), new QuestEvent.Killed("ZOMBIE"), context)
            .state();
    assertThat(state.active("pick").orElseThrow().phase()).isEqualTo(Phase.CHOOSING);
    var again = QuestEngine.handle(state, new QuestEvent.Killed("ZOMBIE"), context);
    assertThat(again.effects()).isEmpty();
    assertThat(again.state()).isEqualTo(state);
  }

  @Test
  void wantsAnswersWhetherAnEventWouldCount() {
    var quest = quest("hunt").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var context = context(facts, quest);
    var state = accepted(empty(), "hunt", context);
    assertThat(QuestEngine.wants(state, new QuestEvent.Killed("ZOMBIE"), context)).isTrue();
    assertThat(QuestEngine.wants(state, new QuestEvent.Killed("SPIDER"), context)).isFalse();
    assertThat(QuestEngine.wants(empty(), new QuestEvent.Killed("ZOMBIE"), context)).isFalse();
  }

  // ---- handing in --------------------------------------------------------------------------

  @Test
  void deliveriesTakeWhatThePlayerHasAndCountPartially() {
    var quest = quest("smith").stage(stage("s").objective(deliver("thomas", IRON, 32))).build();
    var context = context(facts.give(IRON, 20), quest);
    var state = accepted(empty(), "smith", context);
    var partial = QuestEngine.turnIn(state, "thomas", Optional.empty(), context);
    assertThat(partial.effects()).contains(new Effect.World("smith", new Action.Take(IRON, 20)));
    assertThat(partial.state().active("smith").orElseThrow().progress()).containsExactly(20);
    facts.take(IRON, 20).give(IRON, 40);
    var rest = QuestEngine.turnIn(partial.state(), "thomas", Optional.empty(), context);
    assertThat(rest.effects()).contains(new Effect.World("smith", new Action.Take(IRON, 12)));
    assertThat(rest.state().completion("smith")).isPresent();
    assertThat(rest.effects()).contains(new Effect.Say("thomas", "finish smith"));
  }

  @Test
  void handingInAtTheWrongNpcOrWithNothingChangesNothing() {
    var quest = quest("smith").stage(stage("s").objective(deliver("thomas", IRON, 4))).build();
    var context = context(facts, quest);
    var state = accepted(empty(), "smith", context);
    var nothing = QuestEngine.turnIn(state, "thomas", Optional.empty(), context);
    assertThat(nothing.changed(state)).isFalse();
    facts.give(IRON, 4);
    var wrong = QuestEngine.turnIn(state, "nat", Optional.empty(), context);
    assertThat(wrong.changed(state)).isFalse();
  }

  @Test
  void twoDeliveriesOfTheSameItemShareWhatIsCarried() {
    var first = quest("a").stage(stage("s").objective(deliver("thomas", IRON, 3))).build();
    var second = quest("b").stage(stage("s").objective(deliver("thomas", IRON, 3))).build();
    var context = context(facts.give(IRON, 4), first, second);
    var state = accepted(accepted(empty(), "a", context), "b", context);
    var outcome = QuestEngine.turnIn(state, "thomas", Optional.empty(), context);
    assertThat(outcome.effects())
        .contains(
            new Effect.World("a", new Action.Take(IRON, 3)),
            new Effect.World("b", new Action.Take(IRON, 1)));
  }

  @Test
  void aQuestFilterLimitsTheHandIn() {
    var first = quest("a").stage(stage("s").objective(deliver("thomas", IRON, 1))).build();
    var second = quest("b").stage(stage("s").objective(deliver("thomas", IRON, 1))).build();
    var context = context(facts.give(IRON, 4), first, second);
    var state = accepted(accepted(empty(), "a", context), "b", context);
    var outcome = QuestEngine.turnIn(state, "thomas", Optional.of("b"), context);
    assertThat(outcome.state().completion("b")).isPresent();
    assertThat(outcome.state().active("a")).isPresent();
  }

  @Test
  void talkingCountsOnlyOnceTheRestOfTheStageIsDone() {
    var quest =
        quest("report")
            .stage(stage("s").objective(kill("ZOMBIE", 1)).objective(talk("captain")))
            .build();
    var context = context(facts, quest);
    var state = accepted(empty(), "report", context);
    var early = QuestEngine.turnIn(state, "captain", Optional.empty(), context);
    assertThat(early.changed(state)).isFalse();
    var killed = QuestEngine.handle(state, new QuestEvent.Killed("ZOMBIE"), context).state();
    var reported = QuestEngine.turnIn(killed, "captain", Optional.empty(), context);
    assertThat(reported.state().completion("report")).isPresent();
    assertThat(reported.effects()).contains(new Effect.Say("captain", "finish report"));
  }

  @Test
  void deliveriesAndTalkAtTheSameNpcFinishTogether() {
    var quest =
        quest("both")
            .stage(stage("s").objective(deliver("thomas", IRON, 2)).objective(talk("thomas")))
            .build();
    var context = context(facts.give(IRON, 2), quest);
    var state = accepted(empty(), "both", context);
    var outcome = QuestEngine.turnIn(state, "thomas", Optional.empty(), context);
    assertThat(outcome.state().completion("both")).isPresent();
  }

  // ---- measured objectives -----------------------------------------------------------------

  @Test
  void holdObjectivesFollowTheInventoryUntilTheStageIsDone() {
    var quest =
        quest("carry")
            .stage(
                stage("s")
                    .objective(new Objective.Hold(IRON, 10, Optional.empty()))
                    .objective(talk("thomas")))
            .build();
    var context = context(facts.give(IRON, 4), quest);
    var state = accepted(empty(), "carry", context);
    assertThat(state.active("carry").orElseThrow().progress()).containsExactly(4, 0);
    facts.give(IRON, 10);
    var refreshed = QuestEngine.refresh(state, context).state();
    assertThat(refreshed.active("carry").orElseThrow().progress()).containsExactly(10, 0);
    facts.take(IRON, 12);
    var dropped = QuestEngine.refresh(refreshed, context).state();
    assertThat(dropped.active("carry").orElseThrow().progress()).containsExactly(2, 0);
  }

  @Test
  void levelObjectivesCompleteWhenTheTrackReachesTheLevel() {
    var quest =
        quest("train")
            .stage(stage("s").objective(new Objective.Level("mechanic", 2, Optional.empty())))
            .build();
    var context = context(facts.track("mechanic", 1), quest);
    var state = accepted(empty(), "train", context);
    assertThat(state.active("train").orElseThrow().progress()).containsExactly(1);
    facts.track("mechanic", 3);
    assertThat(QuestEngine.refresh(state, context).state().completion("train")).isPresent();
  }

  @Test
  void aLevelAlreadyReachedCompletesOnAccept() {
    var quest =
        quest("train")
            .stage(stage("s").objective(new Objective.Level("mechanic", 2, Optional.empty())))
            .build();
    var state = accepted(empty(), "train", context(facts.track("mechanic", 5), quest));
    assertThat(state.completion("train")).isPresent();
  }

  // ---- branching ---------------------------------------------------------------------------

  @Test
  void guardedBranchesTakeTheFirstThatHolds() {
    var quest =
        quest("fork")
            .stage(
                stage("start")
                    .objective(kill("ZOMBIE", 1))
                    .branches(
                        when("storm", new Condition.WeatherIs(Condition.Weather.THUNDER)),
                        always("calm")))
            .stage(stage("storm").objective(kill("DROWNED", 1)))
            .stage(stage("calm").objective(kill("SKELETON", 1)))
            .start("start")
            .build();
    var calmContext = context(facts, quest);
    var calm =
        QuestEngine.handle(
                accepted(empty(), "fork", calmContext),
                new QuestEvent.Killed("ZOMBIE"),
                calmContext)
            .state();
    assertThat(calm.active("fork").orElseThrow().stage()).isEqualTo("calm");
    var stormFacts = new ScriptedFacts().weather(Condition.Weather.THUNDER);
    var stormContext = context(stormFacts, quest);
    var storm =
        QuestEngine.handle(
                accepted(empty(), "fork", stormContext),
                new QuestEvent.Killed("ZOMBIE"),
                stormContext)
            .state();
    assertThat(storm.active("fork").orElseThrow().stage()).isEqualTo("storm");
  }

  @Test
  void withNoBranchHoldingTheQuestWaitsThenMovesOnWhenOneDoes() {
    var quest =
        quest("wait")
            .stage(
                stage("start")
                    .objective(kill("ZOMBIE", 1))
                    .branches(when("complete", new Condition.WeatherIs(Condition.Weather.THUNDER))))
            .build();
    var context = context(facts, quest);
    var waiting =
        QuestEngine.handle(
                accepted(empty(), "wait", context), new QuestEvent.Killed("ZOMBIE"), context)
            .state();
    assertThat(waiting.active("wait").orElseThrow().phase()).isEqualTo(Phase.WAITING);
    assertThat(QuestEngine.refresh(waiting, context).state()).isEqualTo(waiting);
    facts.weather(Condition.Weather.THUNDER);
    assertThat(QuestEngine.refresh(waiting, context).state().completion("wait")).isPresent();
  }

  @Test
  void stageActionsRunBeforeBranchesAreChosen() {
    var quest =
        quest("count")
            .stage(
                stage("start")
                    .objective(kill("ZOMBIE", 1))
                    .onComplete(new Action.AddVariable("kills", 1))
                    .branches(
                        when(
                            "bonus", new Condition.Compare("kills", Condition.Comparison.EQUAL, 1)),
                        always("complete")))
            .stage(stage("bonus").onComplete(new Action.Crystals(5)))
            .start("start")
            .build();
    var context = context(facts, quest);
    var outcome =
        QuestEngine.handle(
            accepted(empty(), "count", context), new QuestEvent.Killed("ZOMBIE"), context);
    assertThat(outcome.effects()).contains(new Effect.World("count", new Action.Crystals(5)));
    assertThat(outcome.state().completion("count")).isPresent();
    assertThat(outcome.state().variable("kills")).isEqualTo(1);
  }

  @Test
  void aChoiceWaitsForThePlayerAtTheGiver() {
    var quest =
        quest("pick")
            .stage(
                stage("start")
                    .objective(kill("ZOMBIE", 1))
                    .choice(
                        new Stage.Option("Expose", "expose"), new Stage.Option("Bribe", "fail")))
            .stage(stage("expose").onComplete(new Action.Reputation("watch", 2)))
            .start("start")
            .build();
    var context = context(facts, quest);
    var choosing =
        QuestEngine.handle(
            accepted(empty(), "pick", context), new QuestEvent.Killed("ZOMBIE"), context);
    assertThat(choosing.effects()).contains(new Effect.ChoiceNeeded("pick"));
    var state = choosing.state();
    assertThat(refused(QuestEngine.choose(state, "pick", 5, context)))
        .isEqualTo(Refusal.UNKNOWN_OPTION);
    var exposed = ok(QuestEngine.choose(state, "pick", 0, context));
    assertThat(exposed.state().completion("pick")).isPresent();
    assertThat(exposed.state().reputation("watch")).isEqualTo(2);
    assertThat(exposed.effects()).contains(new Effect.ReputationChanged("watch", 2, 2));
    var bribed = ok(QuestEngine.choose(state, "pick", 1, context));
    assertThat(bribed.state().active("pick")).isEmpty();
    assertThat(bribed.state().completion("pick")).isEmpty();
    assertThat(bribed.effects()).contains(new Effect.Failed("pick"));
  }

  @Test
  void choosingOutsideAChoiceIsRefused() {
    var quest = quest("q").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var context = context(facts, quest);
    assertThat(refused(QuestEngine.choose(empty(), "q", 0, context))).isEqualTo(Refusal.NOT_ACTIVE);
    var state = accepted(empty(), "q", context);
    assertThat(refused(QuestEngine.choose(state, "q", 0, context))).isEqualTo(Refusal.NOT_CHOOSING);
  }

  @Test
  void stagesWithoutObjectivesPassStraightThrough() {
    var quest =
        quest("chain")
            .stage(stage("a").then("b").onComplete(new Action.Points(1)))
            .stage(stage("b").then("c").onComplete(new Action.Points(1)))
            .stage(stage("c").objective(kill("ZOMBIE", 1)))
            .start("a")
            .build();
    var state = accepted(empty(), "chain", context(facts, quest));
    assertThat(state.active("chain").orElseThrow().stage()).isEqualTo("c");
    assertThat(state.points()).isEqualTo(2);
  }

  @Test
  void aStageLoopWithNoObjectivesIsStoppedLoudly() {
    var quest =
        quest("spin").stage(stage("a").then("b")).stage(stage("b").then("a")).start("a").build();
    var context = context(facts, quest);
    assertThatThrownBy(() -> QuestEngine.accept(empty(), "spin", context))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("moved more than");
  }

  // ---- time limits -------------------------------------------------------------------------

  @Test
  void aTimeLimitFailsTheQuestOrMovesToItsTarget() {
    var failing =
        quest("rush")
            .stage(
                stage("s")
                    .objective(kill("ZOMBIE", 5))
                    .limit(new Stage.TimeLimit(Duration.ofMinutes(10), Stage.FAIL)))
            .build();
    var context = context(facts, failing);
    var state = accepted(empty(), "rush", context);
    var early = QuestEngine.refresh(state, context(facts, Fixtures.NOW.plusSeconds(599), failing));
    assertThat(early.state().active("rush")).isPresent();
    var late = QuestEngine.refresh(state, context(facts, Fixtures.NOW.plusSeconds(600), failing));
    assertThat(late.state().active("rush")).isEmpty();
    assertThat(late.effects()).contains(new Effect.Failed("rush"));

    var moving =
        quest("ambush")
            .stage(
                stage("s")
                    .objective(kill("ZOMBIE", 5))
                    .limit(new Stage.TimeLimit(Duration.ofMinutes(1), "late")))
            .stage(stage("late").objective(kill("ZOMBIE", 1)))
            .start("s")
            .build();
    var movingState = accepted(empty(), "ambush", context(facts, moving));
    var moved =
        QuestEngine.refresh(movingState, context(facts, Fixtures.NOW.plusSeconds(61), moving));
    assertThat(moved.state().active("ambush").orElseThrow().stage()).isEqualTo("late");
  }

  // ---- actions -----------------------------------------------------------------------------

  @Test
  void stateActionsChangeStateAndWorldActionsBecomeEffects() {
    var follow = quest("follow").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var quest =
        quest("all")
            .stage(stage("s").objective(kill("ZOMBIE", 1)))
            .reward(new Action.SetVariable("x", 5))
            .reward(new Action.AddVariable("x", -2))
            .reward(new Action.Reputation("town", 3))
            .reward(new Action.Points(2))
            .reward(new Action.Marker("nat", Action.NpcMark.AVAILABLE))
            .reward(new Action.StartQuest("follow"))
            .reward(new Action.Title("hero"))
            .reward(new Action.Spell("blink"))
            .reward(new Action.Grant("some.node"))
            .reward(new Action.Message("hi"))
            .reward(new Action.Teleport("spawn"))
            .reward(new Action.Spawn("ZOMBIE", 2, "spawn", Optional.of("Minion")))
            .reward(new Action.Custom("hook", "arg"))
            .reward(new Action.Take(IRON, 1))
            .build();
    var context = context(facts, quest, follow);
    var outcome =
        QuestEngine.handle(
            accepted(empty(), "all", context), new QuestEvent.Killed("ZOMBIE"), context);
    var state = outcome.state();
    assertThat(state.variable("x")).isEqualTo(3);
    assertThat(state.reputation("town")).isEqualTo(3);
    assertThat(state.points()).isEqualTo(2);
    assertThat(state.marks()).containsEntry("nat", Action.NpcMark.AVAILABLE);
    assertThat(state.active("follow")).isPresent();
    assertThat(state.tracked()).contains("follow");
    assertThat(outcome.effects())
        .contains(
            new Effect.PointsGained(2, 2),
            new Effect.Accepted("follow"),
            new Effect.World("all", new Action.Title("hero")),
            new Effect.World("all", new Action.Spell("blink")),
            new Effect.World("all", new Action.Grant("some.node")),
            new Effect.World("all", new Action.Message("hi")),
            new Effect.World("all", new Action.Teleport("spawn")),
            new Effect.World("all", new Action.Spawn("ZOMBIE", 2, "spawn", Optional.of("Minion"))),
            new Effect.World("all", new Action.Custom("hook", "arg")),
            new Effect.World("all", new Action.Take(IRON, 1)));
    assertThat(outcome.effects()).doesNotContain(new Effect.Say("giver", "accept follow"));
  }

  @Test
  void aMarkerOfNoneClearsAPinnedMarker() {
    var state =
        empty().withMark("nat", Action.NpcMark.TURN_IN).withMark("nat", Action.NpcMark.NONE);
    assertThat(state.marks()).isEmpty();
  }

  @Test
  void startingAQuestThatIsNotAvailableDoesNothing() {
    var done = quest("done").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var quest =
        quest("q")
            .stage(stage("s").objective(kill("ZOMBIE", 1)))
            .reward(new Action.StartQuest("done"))
            .reward(new Action.StartQuest("missing"))
            .build();
    var context = context(facts, quest, done);
    var state =
        accepted(empty(), "q", context).withCompletion("done", new Completion(1, Fixtures.NOW));
    var outcome = QuestEngine.handle(state, new QuestEvent.Killed("ZOMBIE"), context);
    assertThat(outcome.state().active()).isEmpty();
  }

  // ---- repeating ---------------------------------------------------------------------------

  @Test
  void aDailyQuestCanBeRepeatedTheNextLocalDay() {
    var quest =
        quest("daily")
            .repeat(Quest.Repeat.DAILY)
            .stage(stage("s").objective(kill("ZOMBIE", 1)))
            .build();
    var context = context(facts, quest);
    var done =
        QuestEngine.handle(
                accepted(empty(), "daily", context), new QuestEvent.Killed("ZOMBIE"), context)
            .state();
    // 23:59 local the same day.
    var lateSameDay = Fixtures.NOW.plus(Duration.ofHours(11).plusMinutes(59));
    assertThat(refused(QuestEngine.accept(done, "daily", context(facts, lateSameDay, quest))))
        .isEqualTo(Refusal.NOT_REPEATABLE_YET);
    var nextDay = Fixtures.NOW.plus(Duration.ofHours(12));
    var again = accepted(done, "daily", context(facts, nextDay, quest));
    var twice =
        QuestEngine.handle(again, new QuestEvent.Killed("ZOMBIE"), context(facts, nextDay, quest))
            .state();
    assertThat(twice.completion("daily").orElseThrow().times()).isEqualTo(2);
  }

  // ---- abandoning and administration -------------------------------------------------------

  @Test
  void abandoningDropsTheQuestAndMovesTracking() {
    var first = quest("first").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var second = quest("second").stage(stage("s").objective(kill("ZOMBIE", 1))).build();
    var context = context(facts, first, second);
    var state = accepted(accepted(empty(), "first", context), "second", context);
    var outcome = ok(QuestEngine.abandon(state, "first", context));
    assertThat(outcome.state().active()).containsOnlyKeys("second");
    assertThat(outcome.state().tracked()).contains("second");
    assertThat(outcome.effects()).containsExactly(new Effect.Abandoned("first"));
    assertThat(refused(QuestEngine.abandon(outcome.state(), "first", context)))
        .isEqualTo(Refusal.NOT_ACTIVE);
  }

  @Test
  void adminResetCompleteAndJump() {
    var quest =
        quest("q")
            .stage(stage("a").objective(kill("ZOMBIE", 1)).then("b"))
            .stage(stage("b").objective(kill("SKELETON", 1)))
            .start("a")
            .reward(new Action.Crystals(10))
            .build();
    var context = context(facts, quest);
    var jumped = ok(QuestEngine.jump(empty(), "q", "b", context)).state();
    assertThat(jumped.active("q").orElseThrow().stage()).isEqualTo("b");
    assertThat(refused(QuestEngine.jump(empty(), "q", "zzz", context)))
        .isEqualTo(Refusal.UNKNOWN_STAGE);
    var completed = ok(QuestEngine.complete(jumped, "q", context));
    assertThat(completed.state().completion("q")).isPresent();
    assertThat(completed.effects()).contains(new Effect.World("q", new Action.Crystals(10)));
    var reset = QuestEngine.reset(completed.state(), "q", context).state();
    assertThat(reset.completion("q")).isEmpty();
    assertThat(reset.active("q")).isEmpty();
    assertThat(refused(QuestEngine.complete(empty(), "zzz", context)))
        .isEqualTo(Refusal.UNKNOWN_QUEST);
  }

  @Test
  void reachEventsCountRegions() {
    var quest =
        quest("go")
            .stage(stage("s").objective(new Objective.Reach("mines", Optional.empty())))
            .build();
    var context = context(facts, quest);
    var state = accepted(empty(), "go", context);
    assertThat(
            QuestEngine.handle(state, new QuestEvent.Reached(Set.of("elsewhere")), context)
                .effects())
        .isEmpty();
    assertThat(
            QuestEngine.handle(state, new QuestEvent.Reached(Set.of("mines")), context)
                .state()
                .completion("go"))
        .isPresent();
  }
}
