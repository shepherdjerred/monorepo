package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The quest statechart. Every operation is a pure function from a player's state (and what the
 * world says) to a new state and the effects to carry out. Main-thread callers apply the effects;
 * nothing here touches the server.
 *
 * <p>A stage is done when all its objectives are. Then its {@code onComplete} actions run and its
 * {@code next} decides: the first guarded branch whose conditions hold, or a choice the player
 * makes at the giver. With no branch holding, the quest waits and is re-checked on every refresh.
 * Entering a stage with no objectives completes it at once, so stages can be pure decision points.
 */
public final class QuestEngine {

  /** More transitions than this in one step means a loop the validator should have caught. */
  static final int MAX_TRANSITIONS = 64;

  /**
   * What an engine step needs.
   *
   * @param catalog the quests this player can see
   * @param facts what the world says about the player
   * @param now the current instant
   * @param calendar days and weeks, for repeatable quests
   */
  public record Context(Catalog catalog, Facts facts, Instant now, Calendar calendar) {}

  /** Whether a player can take a quest. */
  public enum Availability {
    /** It can be accepted now. */
    OFFERABLE,
    /** It is already active. */
    ACTIVE,
    /** It was completed and cannot be repeated yet (or ever). */
    DONE,
    /** Its requirements do not hold. */
    LOCKED
  }

  /** Why an operation was refused. */
  public enum Refusal {
    UNKNOWN_QUEST,
    ALREADY_ACTIVE,
    NOT_REPEATABLE_YET,
    REQUIREMENTS_UNMET,
    NOT_ACTIVE,
    NOT_CHOOSING,
    UNKNOWN_OPTION,
    UNKNOWN_STAGE
  }

  private final Context context;
  private final List<Effect> effects = new ArrayList<>();
  private PlayerQuests state;
  private int transitions;

  private QuestEngine(Context context, PlayerQuests state) {
    this.context = context;
    this.state = state;
  }

  // ---- queries -------------------------------------------------------------------------------

  /** Whether {@code quest} can be taken now. */
  public static Availability availability(PlayerQuests state, Quest quest, Context context) {
    if (state.active(quest.id()).isPresent()) {
      return Availability.ACTIVE;
    }
    if (!context
        .calendar()
        .available(quest.repeat(), state.completion(quest.id()), context.now())) {
      return Availability.DONE;
    }
    return Conditions.all(quest.requirements(), state, context.facts())
        ? Availability.OFFERABLE
        : Availability.LOCKED;
  }

  /** Whether {@code event} would count for any of the player's active objectives. */
  public static boolean wants(PlayerQuests state, QuestEvent event, Context context) {
    for (var active : state.active().values()) {
      if (active.phase() != Phase.IN_PROGRESS) {
        continue;
      }
      var stage = stageOf(context.catalog(), active);
      for (var index = 0; index < stage.objectives().size(); index++) {
        var objective = stage.objectives().get(index);
        if (active.count(index) < objective.required() && Credit.of(objective, event) > 0) {
          return true;
        }
      }
    }
    return false;
  }

  /** The current stage of an active quest. */
  public static Stage stageOf(Catalog catalog, ActiveQuest active) {
    return catalog
        .require(active.quest())
        .stage(active.stage())
        .orElseThrow(
            () ->
                new IllegalStateException(
                    "quest " + active.quest() + " has no stage " + active.stage()));
  }

  // ---- player operations ---------------------------------------------------------------------

  /** The player accepts {@code quest}. */
  public static Result<Outcome, Refusal> accept(PlayerQuests state, String quest, Context context) {
    var found = context.catalog().quest(quest);
    if (found.isEmpty()) {
      return Result.err(Refusal.UNKNOWN_QUEST);
    }
    return switch (availability(state, found.get(), context)) {
      case ACTIVE -> Result.err(Refusal.ALREADY_ACTIVE);
      case DONE -> Result.err(Refusal.NOT_REPEATABLE_YET);
      case LOCKED -> Result.err(Refusal.REQUIREMENTS_UNMET);
      case OFFERABLE -> {
        var engine = new QuestEngine(context, state);
        engine.begin(found.get(), true);
        yield Result.ok(engine.outcome());
      }
    };
  }

  /** Counts {@code event} toward every active objective it matches. */
  public static Outcome handle(PlayerQuests state, QuestEvent event, Context context) {
    var engine = new QuestEngine(context, state);
    for (var quest : List.copyOf(state.active().keySet())) {
      engine.count(quest, event);
    }
    return engine.outcome();
  }

  /**
   * The player hands in at {@code npc}: deliveries for every active quest (or only {@code quest})
   * whose current stage delivers there, then talk objectives there once the rest of their stage is
   * done.
   */
  public static Outcome turnIn(
      PlayerQuests state, String npc, Optional<String> quest, Context context) {
    var engine = new QuestEngine(context, state);
    var taken = new HashMap<ItemMatch, Integer>();
    for (var id : List.copyOf(state.active().keySet())) {
      if (quest.isEmpty() || quest.get().equals(id)) {
        engine.handIn(id, npc, taken);
      }
    }
    return engine.outcome();
  }

  /** The player picks option {@code option} of a quest waiting for a choice. */
  public static Result<Outcome, Refusal> choose(
      PlayerQuests state, String quest, int option, Context context) {
    var active = state.active(quest);
    if (active.isEmpty()) {
      return Result.err(Refusal.NOT_ACTIVE);
    }
    if (active.get().phase() != Phase.CHOOSING
        || !(stageOf(context.catalog(), active.get()).next() instanceof Stage.Next.Choice choice)) {
      return Result.err(Refusal.NOT_CHOOSING);
    }
    if (option < 0 || option >= choice.options().size()) {
      return Result.err(Refusal.UNKNOWN_OPTION);
    }
    var engine = new QuestEngine(context, state);
    var found = context.catalog().require(quest);
    engine.go(found, choice.options().get(option).target(), found.giver());
    return Result.ok(engine.outcome());
  }

  /** The player drops {@code quest}. */
  public static Result<Outcome, Refusal> abandon(
      PlayerQuests state, String quest, Context context) {
    if (state.active(quest).isEmpty()) {
      return Result.err(Refusal.NOT_ACTIVE);
    }
    var engine = new QuestEngine(context, state);
    engine.drop(quest);
    engine.effects.add(new Effect.Abandoned(quest));
    return Result.ok(engine.outcome());
  }

  /**
   * Re-reads what the world says: held items and track levels, time limits, and branches a waiting
   * quest may now take. Run periodically.
   */
  public static Outcome refresh(PlayerQuests state, Context context) {
    var engine = new QuestEngine(context, state);
    for (var quest : List.copyOf(state.active().keySet())) {
      engine.recheck(quest);
    }
    return engine.outcome();
  }

  // ---- administration ------------------------------------------------------------------------

  /** Forgets {@code quest} entirely: not active and never completed. */
  public static Outcome reset(PlayerQuests state, String quest, Context context) {
    var engine = new QuestEngine(context, state);
    engine.drop(quest);
    engine.state = engine.state.withoutCompletion(quest);
    return engine.outcome();
  }

  /** Completes {@code quest} now, with its rewards, whatever stage it was in. */
  public static Result<Outcome, Refusal> complete(
      PlayerQuests state, String quest, Context context) {
    var found = context.catalog().quest(quest);
    if (found.isEmpty()) {
      return Result.err(Refusal.UNKNOWN_QUEST);
    }
    var engine = new QuestEngine(context, state);
    engine.finish(found.get(), found.get().giver());
    return Result.ok(engine.outcome());
  }

  /** Puts the player in {@code stage} of {@code quest}, taking the quest if needed. */
  public static Result<Outcome, Refusal> jump(
      PlayerQuests state, String quest, String stage, Context context) {
    var found = context.catalog().quest(quest);
    if (found.isEmpty()) {
      return Result.err(Refusal.UNKNOWN_QUEST);
    }
    if (found.get().stage(stage).isEmpty()) {
      return Result.err(Refusal.UNKNOWN_STAGE);
    }
    var engine = new QuestEngine(context, state);
    engine.enter(found.get(), stage, found.get().giver());
    return Result.ok(engine.outcome());
  }

  // ---- transitions ---------------------------------------------------------------------------

  private Outcome outcome() {
    return new Outcome(state, effects);
  }

  private Quest quest(String id) {
    return context.catalog().require(id);
  }

  private void begin(Quest quest, boolean greet) {
    guard(quest);
    effects.add(new Effect.Accepted(quest.id()));
    if (state.tracked().isEmpty()) {
      state = state.withTracked(Optional.of(quest.id()));
    }
    if (greet) {
      effects.add(new Effect.Say(quest.giver(), quest.text().accept()));
    }
    quest.onAccept().forEach(action -> apply(quest, action));
    enter(quest, quest.start(), quest.giver());
  }

  private void enter(Quest quest, String stageId, String speaker) {
    guard(quest);
    var stage = quest.stage(stageId).orElseThrow();
    var startedAt = state.active(quest.id()).map(ActiveQuest::startedAt).orElseGet(context::now);
    state =
        state.withActive(
            ActiveQuest.entering(quest.id(), stageId, stage.objectives().size(), context.now())
                .withStartedAt(startedAt));
    effects.add(new Effect.StageStarted(quest.id(), stageId));
    measure(quest);
    if (isDone(quest)) {
      completeStage(quest, speaker);
    }
  }

  private void count(String questId, QuestEvent event) {
    var active = state.active(questId);
    if (active.isEmpty() || active.get().phase() != Phase.IN_PROGRESS) {
      return;
    }
    var quest = quest(questId);
    var current = active.get();
    var stage = stageOf(context.catalog(), current);
    var changed = false;
    for (var index = 0; index < stage.objectives().size(); index++) {
      var objective = stage.objectives().get(index);
      var add = Credit.of(objective, event);
      if (add > 0 && current.count(index) < objective.required()) {
        current = raise(current, index, current.count(index) + add, objective.required());
        changed = true;
      }
    }
    if (changed) {
      state = state.withActive(current);
      if (isDone(quest)) {
        completeStage(quest, quest.giver());
      }
    }
  }

  private void handIn(String questId, String npc, Map<ItemMatch, Integer> taken) {
    var active = state.active(questId);
    if (active.isEmpty() || active.get().phase() != Phase.IN_PROGRESS) {
      return;
    }
    var quest = quest(questId);
    var stage = stageOf(context.catalog(), active.get());
    var current = report(stage, deliver(stage, active.get(), npc, taken), npc);
    if (!current.equals(active.get())) {
      state = state.withActive(current);
      if (isDone(quest)) {
        completeStage(quest, npc);
      }
    }
  }

  /** Hands over what the player carries for deliveries to {@code npc}. */
  private ActiveQuest deliver(
      Stage stage, ActiveQuest active, String npc, Map<ItemMatch, Integer> taken) {
    var current = active;
    for (var index = 0; index < stage.objectives().size(); index++) {
      if (stage.objectives().get(index) instanceof Objective.Deliver deliver
          && deliver.npc().equals(npc)) {
        var need = deliver.amount() - current.count(index);
        var have = context.facts().count(deliver.item()) - taken.getOrDefault(deliver.item(), 0);
        var give = Math.min(need, have);
        if (give > 0) {
          taken.merge(deliver.item(), give, Integer::sum);
          effects.add(new Effect.World(active.quest(), new Action.Take(deliver.item(), give)));
          current = raise(current, index, current.count(index) + give, deliver.amount());
        }
      }
    }
    return current;
  }

  /** Counts talking to {@code npc} once the stage's non-conversation work is done. */
  private ActiveQuest report(Stage stage, ActiveQuest active, String npc) {
    if (!reportsAt(stage, active)) {
      return active;
    }
    var current = active;
    for (var index = 0; index < stage.objectives().size(); index++) {
      if (stage.objectives().get(index) instanceof Objective.Talk talk
          && talk.npc().equals(npc)
          && current.count(index) == 0) {
        current = raise(current, index, 1, 1);
      }
    }
    return current;
  }

  /** Whether every non-conversation objective is done. Conversations can happen in any order. */
  public static boolean reportsAt(Stage stage, ActiveQuest active) {
    for (var index = 0; index < stage.objectives().size(); index++) {
      var objective = stage.objectives().get(index);
      if (!(objective instanceof Objective.Talk) && active.count(index) < objective.required()) {
        return false;
      }
    }
    return true;
  }

  private void recheck(String questId) {
    var active = state.active(questId);
    if (active.isEmpty()) {
      return;
    }
    var quest = quest(questId);
    var stage = stageOf(context.catalog(), active.get());
    var limit = stage.timeLimit();
    if (limit.isPresent()
        && !context.now().isBefore(active.get().stageStartedAt().plus(limit.get().limit()))) {
      go(quest, limit.get().target(), quest.giver());
      return;
    }
    switch (active.get().phase()) {
      case IN_PROGRESS -> {
        measure(quest);
        if (isDone(quest)) {
          completeStage(quest, quest.giver());
        }
      }
      case WAITING -> advance(quest, quest.giver());
      case CHOOSING -> {
        // Only the player's choice moves it on.
      }
    }
  }

  /** Updates objectives that measure the world rather than count events. */
  private void measure(Quest quest) {
    var current = state.active(quest.id()).orElseThrow();
    var stage = stageOf(context.catalog(), current);
    for (var index = 0; index < stage.objectives().size(); index++) {
      var measured = measured(stage.objectives().get(index));
      if (measured.isPresent() && measured.get() != current.count(index)) {
        var required = stage.objectives().get(index).required();
        current =
            measured.get() > current.count(index)
                ? raise(current, index, measured.get(), required)
                : current.withCount(index, measured.get());
      }
    }
    state = state.withActive(current);
  }

  private Optional<Integer> measured(Objective objective) {
    return switch (objective) {
      case Objective.Hold(var item, var amount, _) ->
          Optional.of(Math.min(amount, context.facts().count(item)));
      case Objective.Level(var track, var level, _) ->
          Optional.of(Math.min(level, context.facts().trackLevel(track)));
      case Objective.Talk _,
          Objective.Deliver _,
          Objective.Collect _,
          Objective.Craft _,
          Objective.Fish _,
          Objective.Mine _,
          Objective.Place _,
          Objective.Kill _,
          Objective.Reach _,
          Objective.Custom _ ->
          Optional.empty();
    };
  }

  private ActiveQuest raise(ActiveQuest active, int index, int count, int required) {
    var capped = Math.min(count, required);
    effects.add(new Effect.Progressed(active.quest(), active.stage(), index, capped, required));
    return active.withCount(index, capped);
  }

  private boolean isDone(Quest quest) {
    var active = state.active(quest.id()).orElseThrow();
    var stage = stageOf(context.catalog(), active);
    for (var index = 0; index < stage.objectives().size(); index++) {
      if (active.count(index) < stage.objectives().get(index).required()) {
        return false;
      }
    }
    return true;
  }

  private void completeStage(Quest quest, String speaker) {
    var active = state.active(quest.id()).orElseThrow();
    var stage = stageOf(context.catalog(), active);
    stage.complete().ifPresent(text -> effects.add(new Effect.Say(speaker, text)));
    state = state.withActive(active.withPhase(Phase.WAITING));
    stage.onComplete().forEach(action -> apply(quest, action));
    if (state.active(quest.id()).isPresent()) {
      advance(quest, speaker);
    }
  }

  private void advance(Quest quest, String speaker) {
    var active = state.active(quest.id()).orElseThrow();
    var stage = stageOf(context.catalog(), active);
    switch (stage.next()) {
      case Stage.Next.Choice _ -> {
        if (active.phase() != Phase.CHOOSING) {
          state = state.withActive(active.withPhase(Phase.CHOOSING));
          effects.add(new Effect.ChoiceNeeded(quest.id()));
        }
      }
      case Stage.Next.Guarded(var branches) -> {
        var taken =
            branches.stream()
                .filter(branch -> Conditions.all(branch.when(), state, context.facts()))
                .findFirst();
        if (taken.isPresent()) {
          go(quest, taken.get().target(), speaker);
        } else if (active.phase() != Phase.WAITING) {
          state = state.withActive(active.withPhase(Phase.WAITING));
        }
      }
    }
  }

  private void go(Quest quest, String target, String speaker) {
    guard(quest);
    switch (target) {
      case Stage.COMPLETE -> finish(quest, speaker);
      case Stage.FAIL -> {
        drop(quest.id());
        effects.add(new Effect.Failed(quest.id()));
      }
      default -> enter(quest, target, speaker);
    }
  }

  private void finish(Quest quest, String speaker) {
    drop(quest.id());
    var completion =
        state
            .completion(quest.id())
            .map(done -> done.again(context.now()))
            .orElseGet(() -> new Completion(1, context.now()));
    state = state.withCompletion(quest.id(), completion);
    effects.add(new Effect.Say(speaker, quest.text().finish()));
    effects.add(new Effect.Completed(quest.id()));
    quest.rewards().forEach(action -> apply(quest, action));
  }

  /** Removes {@code quest} from the active set and moves tracking on if it was tracked. */
  private void drop(String quest) {
    state = state.withoutActive(quest);
    if (state.tracked().filter(quest::equals).isPresent()) {
      state = state.withTracked(state.active().keySet().stream().findFirst());
    }
  }

  private void apply(Quest quest, Action action) {
    switch (action) {
      case Action.SetVariable(var name, var value) -> state = state.withVariable(name, value);
      case Action.AddVariable(var name, var delta) ->
          state = state.withVariable(name, state.variable(name) + delta);
      case Action.Reputation(var faction, var delta) -> {
        var total = state.reputation(faction) + delta;
        state = state.withReputation(faction, total);
        effects.add(new Effect.ReputationChanged(faction, delta, total));
      }
      case Action.Points(var amount) -> {
        state = state.withPoints(state.points() + amount);
        effects.add(new Effect.PointsGained(amount, state.points()));
      }
      case Action.Marker(var npc, var mark) -> state = state.withMark(npc, mark);
      case Action.StartQuest(var id) -> startFromAction(id);
      case Action.Give _,
          Action.Take _,
          Action.Crystals _,
          Action.Grant _,
          Action.Title _,
          Action.Spell _,
          Action.Message _,
          Action.Teleport _,
          Action.Spawn _,
          Action.Custom _ ->
          effects.add(new Effect.World(quest.id(), action));
    }
  }

  /** Starts a follow-up quest if it could be taken, ignoring its requirements. */
  private void startFromAction(String id) {
    var next = context.catalog().quest(id);
    if (next.isEmpty()
        || state.active(id).isPresent()
        || !context
            .calendar()
            .available(next.get().repeat(), state.completion(id), context.now())) {
      return;
    }
    begin(next.get(), false);
  }

  private void guard(Quest quest) {
    transitions++;
    if (transitions > MAX_TRANSITIONS) {
      throw new IllegalStateException(
          "quest " + quest.id() + " moved more than " + MAX_TRANSITIONS + " times in one step");
    }
  }
}
