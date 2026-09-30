package com.shepherdjerred.thestorm.quests.domain.sim;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.engine.Calendar;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.engine.Effect;
import com.shepherdjerred.thestorm.quests.domain.engine.Outcome;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Context;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Refusal;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEvent;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest.Phase;
import com.shepherdjerred.thestorm.quests.domain.state.Completion;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Plays a quest through with scripted events: it satisfies the requirements, accepts, then does
 * whatever each stage asks (kills, deliveries, trips) until the quest ends, taking every option of
 * every choice as a separate run. Each run records a transcript and the crystals paid. A run that
 * gets stuck, fails, or loops is reported rather than thrown.
 */
public final class Simulator {

  /** Steps after which a run is declared stuck. */
  static final int MAX_STEPS = 200;

  private static final UUID PLAYER = new UUID(0, 1);

  /**
   * One path through a quest.
   *
   * @param quest the quest id
   * @param choices the option index taken at each choice
   * @param completed whether the quest completed
   * @param crystals crystals paid along the way
   * @param state the player's state at the end
   * @param transcript what happened, one line per step
   */
  public record Run(
      String quest,
      List<Integer> choices,
      boolean completed,
      long crystals,
      PlayerQuests state,
      List<String> transcript) {

    public Run {
      choices = List.copyOf(choices);
      transcript = List.copyOf(transcript);
    }
  }

  private final Catalog catalog;
  private final Calendar calendar;
  private final Instant now;
  private final List<Run> runs = new ArrayList<>();

  private Simulator(Catalog catalog, Calendar calendar, Instant now) {
    this.catalog = catalog;
    this.calendar = calendar;
    this.now = now;
  }

  /** Every run through {@code quest}. */
  public static List<Run> simulate(Catalog catalog, Quest quest, Calendar calendar, Instant now) {
    var simulator = new Simulator(catalog, calendar, now);
    var facts = new ScriptedFacts();
    var state = satisfy(catalog, PlayerQuests.empty(PLAYER), quest.requirements(), facts);
    var transcript = new ArrayList<String>();
    transcript.add("accept " + quest.id());
    var context = new Context(catalog, facts, now, calendar);
    switch (QuestEngine.accept(state, quest.id(), context)) {
      case Result.Ok<Outcome, Refusal>(var outcome) -> {
        var path = paid(new Path(quest, facts, transcript, new ArrayList<>(), 0), outcome);
        simulator.play(path, simulator.apply(path, outcome));
      }
      case Result.Err<Outcome, Refusal>(var refusal) -> {
        transcript.add("refused: " + refusal);
        simulator.runs.add(new Run(quest.id(), List.of(), false, 0, state, transcript));
      }
    }
    return List.copyOf(simulator.runs);
  }

  /** A run in progress. */
  private record Path(
      Quest quest,
      ScriptedFacts facts,
      List<String> transcript,
      List<Integer> choices,
      long crystals) {

    Path fork(int option) {
      var picked = new ArrayList<>(choices);
      picked.add(option);
      return new Path(quest, facts.copy(), new ArrayList<>(transcript), picked, crystals);
    }

    Path paid(long amount) {
      return new Path(quest, facts, transcript, choices, crystals + amount);
    }
  }

  private void play(Path start, PlayerQuests initial) {
    var path = start;
    var state = initial;
    for (var step = 0; step < MAX_STEPS; step++) {
      var active = state.active(path.quest().id());
      if (active.isEmpty()) {
        finish(path, state);
        return;
      }
      var stage = QuestEngine.stageOf(catalog, active.get());
      if (active.get().phase() == Phase.CHOOSING
          && stage.next() instanceof Stage.Next.Choice(var options)) {
        forkChoices(path, state, options);
        return;
      }
      var before = state;
      var outcome = step(path, state, stage, active.get());
      path = paid(path, outcome);
      state = apply(path, outcome);
      if (state.equals(before) && outcome.effects().isEmpty()) {
        path.transcript().add("stuck in stage " + stage.id());
        runs.add(
            new Run(
                path.quest().id(),
                path.choices(),
                false,
                path.crystals(),
                state,
                path.transcript()));
        return;
      }
    }
    path.transcript().add("gave up after " + MAX_STEPS + " steps");
    runs.add(
        new Run(
            path.quest().id(), path.choices(), false, path.crystals(), state, path.transcript()));
  }

  /** Plays each option of a choice as its own run. */
  private void forkChoices(Path path, PlayerQuests state, List<Stage.Option> options) {
    for (var index = 0; index < options.size(); index++) {
      var branch = path.fork(index);
      branch.transcript().add("choose " + options.get(index).label());
      var context = new Context(catalog, branch.facts(), now, calendar);
      switch (QuestEngine.choose(state, path.quest().id(), index, context)) {
        case Result.Ok<Outcome, Refusal>(var outcome) -> {
          var paid = paid(branch, outcome);
          play(paid, apply(paid, outcome));
        }
        case Result.Err<Outcome, Refusal>(var refusal) ->
            throw new IllegalStateException("choice refused: " + refusal);
      }
    }
  }

  private void finish(Path path, PlayerQuests state) {
    var completed = state.completion(path.quest().id()).isPresent();
    path.transcript().add(completed ? "completed" : "ended without completing");
    runs.add(
        new Run(
            path.quest().id(),
            path.choices(),
            completed,
            path.crystals(),
            state,
            path.transcript()));
  }

  /** Does the first unfinished objective of the stage, or satisfies a waiting branch. */
  private Outcome step(Path path, PlayerQuests state, Stage stage, ActiveQuest active) {
    var facts = path.facts();
    var context = new Context(catalog, facts, now, calendar);
    if (active.phase() == Phase.WAITING) {
      if (stage.next() instanceof Stage.Next.Guarded(var branches)) {
        var prepared = satisfy(catalog, state, branches.getFirst().when(), facts);
        path.transcript().add("wait for " + branches.getFirst().target());
        return QuestEngine.refresh(prepared, context);
      }
      return Outcome.unchanged(state);
    }
    var next = nextObjective(stage, active);
    if (next.isEmpty()) {
      return QuestEngine.refresh(state, context);
    }
    var objective = stage.objectives().get(next.get());
    var remaining = objective.required() - active.count(next.get());
    path.transcript().add(stage.id() + ": " + objective);
    return perform(objective, remaining, state, facts);
  }

  /** The first unfinished objective, reporting (talking) last. */
  private static Optional<Integer> nextObjective(Stage stage, ActiveQuest active) {
    Optional<Integer> talk = Optional.empty();
    for (var index = 0; index < stage.objectives().size(); index++) {
      if (active.count(index) < stage.objectives().get(index).required()) {
        if (!(stage.objectives().get(index) instanceof Objective.Talk)) {
          return Optional.of(index);
        }
        if (talk.isEmpty()) {
          talk = Optional.of(index);
        }
      }
    }
    return talk;
  }

  private Outcome perform(
      Objective objective, int remaining, PlayerQuests state, ScriptedFacts facts) {
    var context = new Context(catalog, facts, now, calendar);
    return switch (objective) {
      case Objective.Talk(var npc, _) -> QuestEngine.turnIn(state, npc, Optional.empty(), context);
      case Objective.Deliver(var npc, var item, _, _) -> {
        facts.give(item, remaining);
        yield QuestEngine.turnIn(state, npc, Optional.empty(), context);
      }
      case Objective.Hold(var item, _, _) -> {
        facts.give(item, remaining);
        yield QuestEngine.refresh(state, context);
      }
      case Objective.Level(var track, var level, _) -> {
        facts.track(track, level);
        yield QuestEngine.refresh(state, context);
      }
      case Objective.Collect(var item, _, _) ->
          QuestEngine.handle(
              state, new QuestEvent.Collected(Items.facts(item), remaining), context);
      case Objective.Craft(var item, _, _) ->
          QuestEngine.handle(state, new QuestEvent.Crafted(Items.facts(item), remaining), context);
      case Objective.Fish(var item, _, _) ->
          repeat(
              state,
              new QuestEvent.Fished(Items.facts(item.orElseGet(() -> ItemMatch.of("COD")))),
              remaining,
              context);
      case Objective.Mine(var block, _, _) ->
          repeat(state, new QuestEvent.Mined(block), remaining, context);
      case Objective.Place(var block, _, _) ->
          repeat(state, new QuestEvent.Placed(block), remaining, context);
      case Objective.Kill(var entity, _, _) ->
          repeat(state, new QuestEvent.Killed(entity), remaining, context);
      case Objective.Reach(var region, _) -> {
        facts.at(region);
        yield QuestEngine.handle(state, new QuestEvent.Reached(Set.of(region)), context);
      }
      case Objective.Custom(var hook, _, _) ->
          QuestEngine.handle(state, new QuestEvent.Hook(hook, remaining), context);
    };
  }

  private static Outcome repeat(PlayerQuests state, QuestEvent event, int times, Context context) {
    var current = state;
    var effects = new ArrayList<Effect>();
    for (var index = 0; index < times; index++) {
      var outcome = QuestEngine.handle(current, event, context);
      current = outcome.state();
      effects.addAll(outcome.effects());
    }
    return new Outcome(current, effects);
  }

  /** Carries out item effects on the scripted inventory and logs the rest. */
  private PlayerQuests apply(Path path, Outcome outcome) {
    for (var effect : outcome.effects()) {
      if (effect instanceof Effect.World(var quest, var action)) {
        if (action instanceof Action.Take(var item, var amount)) {
          path.facts().take(item, Math.min(amount, path.facts().count(item)));
        } else if (action instanceof Action.Give(var item, var amount)) {
          path.facts().give(item, amount);
        }
        path.transcript().add("  " + quest + ": " + action);
      } else if (!(effect instanceof Effect.Progressed)) {
        path.transcript().add("  " + effect);
      }
    }
    return outcome.state();
  }

  private static Path paid(Path path, Outcome outcome) {
    var crystals =
        outcome.effects().stream()
            .mapToLong(
                effect ->
                    effect instanceof Effect.World(var quest, Action.Crystals(var amount))
                            && quest.equals(path.quest().id())
                        ? amount
                        : 0)
            .sum();
    return path.paid(crystals);
  }

  /**
   * Changes {@code state} and {@code facts} so {@code conditions} hold: required quests counted as
   * completed, reputation, points and variables set, items given, the clock and weather set.
   */
  static PlayerQuests satisfy(
      Catalog catalog, PlayerQuests state, List<Condition> conditions, ScriptedFacts facts) {
    var current = state;
    for (var condition : conditions) {
      current = satisfy(catalog, current, condition, facts);
    }
    return current;
  }

  private static PlayerQuests satisfy(
      Catalog catalog, PlayerQuests state, Condition condition, ScriptedFacts facts) {
    return switch (condition) {
      case Condition.HasItem(var item, var amount) -> {
        facts.give(item, amount);
        yield state;
      }
      case Condition.TrackAtLeast(var track, var level) -> {
        facts.track(track, level);
        yield state;
      }
      case Condition.Completed(var quest) ->
          state.withCompletion(quest, new Completion(1, Instant.EPOCH));
      case Condition.Active(var quest) -> {
        var other = catalog.require(quest);
        var stage = other.stage(other.start()).orElseThrow();
        yield state.withActive(
            ActiveQuest.entering(quest, other.start(), stage.objectives().size(), Instant.EPOCH));
      }
      case Condition.ReputationAtLeast(var faction, var amount) ->
          state.withReputation(faction, Math.max(amount, state.reputation(faction)));
      case Condition.PointsAtLeast(var amount) ->
          state.withPoints(Math.max(amount, state.points()));
      case Condition.TimeBetween(var from, _) -> {
        facts.time(from);
        yield state;
      }
      case Condition.WeatherIs(var weather) -> {
        facts.weather(weather);
        yield state;
      }
      case Condition.InRegion(var region) -> {
        facts.at(region);
        yield state;
      }
      case Condition.HasPermission(var node) -> {
        facts.permit(node);
        yield state;
      }
      case Condition.Compare(var variable, var comparison, var value) ->
          state.withVariable(variable, satisfying(comparison, value));
      case Condition.Not _ -> state;
    };
  }

  private static long satisfying(Condition.Comparison comparison, long value) {
    return switch (comparison) {
      case EQUAL, LESS_OR_EQUAL, GREATER_OR_EQUAL -> value;
      case NOT_EQUAL, GREATER -> value + 1;
      case LESS -> value - 1;
    };
  }
}
