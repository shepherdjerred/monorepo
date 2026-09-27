package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.app.QuestStore.PendingWorld;
import com.shepherdjerred.thestorm.quests.domain.board.BoardQuests;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.engine.Effect;
import com.shepherdjerred.thestorm.quests.domain.engine.Facts;
import com.shepherdjerred.thestorm.quests.domain.engine.Outcome;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Context;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Refusal;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEvent;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import com.shepherdjerred.thestorm.quests.domain.view.Describe;
import com.shepherdjerred.thestorm.quests.domain.view.Dialogues;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import com.shepherdjerred.thestorm.quests.domain.view.Markers;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue;
import java.time.InstantSource;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.UnaryOperator;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.entity.Player;

/**
 * The quest use cases, on the main thread. Each online player's state is held in memory and saved
 * after every change (saves run in order on the database writer). Every change goes through the
 * pure {@link QuestEngine}; this class only loads, saves, draws boards, and carries out effects.
 */
public final class QuestService implements QuestHooks, QuestProgress {

  /**
   * What the service needs.
   *
   * @param content the quest content
   * @param config quests.yml
   * @param store where state is kept
   * @param world the server
   * @param rewards pays crystals and grants permissions
   * @param npcNames an NPC id to its display name
   * @param mainThread completes futures back on the main thread
   * @param time the clock
   * @param random draws board quests
   * @param logger the module logger
   */
  public record Wiring(
      QuestContent content,
      QuestsConfig config,
      QuestStore store,
      QuestWorld world,
      Rewards rewards,
      UnaryOperator<String> npcNames,
      Executor mainThread,
      InstantSource time,
      RandomGenerator random,
      ComponentLogger logger) {}

  private final Wiring wiring;
  private final Notices notices;
  private final Describe.Lookup lookup;
  private final Map<UUID, PlayerQuests> sessions = new HashMap<>();
  private final Map<UUID, CompletableFuture<Void>> loading = new HashMap<>();
  private final Map<UUID, CompletableFuture<Void>> saving = new HashMap<>();
  private final Map<UUID, ArrayDeque<Runnable>> queued = new HashMap<>();
  private final Map<UUID, Long> generations = new HashMap<>();
  private final Set<UUID> departing = new HashSet<>();
  private final Set<UUID> delivering = new HashSet<>();
  private final Set<UUID> deliveryRequested = new HashSet<>();
  private final Map<UUID, List<QuestWorld.TakenItems>> refunds = new HashMap<>();
  private final Map<String, CustomAction> customActions = new HashMap<>();

  public QuestService(Wiring wiring) {
    this.wiring = wiring;
    this.lookup =
        new Describe.Lookup(
            wiring.npcNames(),
            region -> wiring.content().region(region).map(found -> found.name()).orElse(region));
    this.notices = new Notices(wiring.content(), lookup);
  }

  // ---- sessions ------------------------------------------------------------------------------

  /** Loads {@code player}'s state; until it arrives they have no quests. */
  public CompletableFuture<Void> join(UUID player) {
    if (wiring.world().facts(player).isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }
    var save = saving.get(player);
    if (save != null) {
      return save.handleAsync((ignored, failure) -> null, wiring.mainThread())
          .thenCompose(ignored -> join(player));
    }
    departing.remove(player);
    var pending = loading.get(player);
    if (pending != null) {
      return pending;
    }
    long generation = generations.getOrDefault(player, 0L);
    var started =
        wiring
            .store()
            .load(player)
            .thenAcceptAsync(
                state -> {
                  if (generations.getOrDefault(player, 0L) != generation) {
                    return;
                  }
                  loading.remove(player);
                  if (wiring.world().facts(player).isEmpty()) {
                    return;
                  }
                  sessions.put(player, state);
                  returnReserved(player);
                  deliverPending(player);
                  refresh(player);
                },
                wiring.mainThread())
            .exceptionallyAsync(
                failure -> {
                  if (generations.getOrDefault(player, 0L) != generation) {
                    return null;
                  }
                  loading.remove(player);
                  wiring.logger().error("Could not load quests for {}", player, failure);
                  return null;
                },
                wiring.mainThread());
    loading.put(player, started);
    if (started.isDone()) {
      loading.remove(player, started);
    }
    return started;
  }

  /** Resumes durable rewards and the journal when a loaded player returns to the main world. */
  public void resume(UUID player) {
    if (!sessions.containsKey(player) || wiring.world().facts(player).isEmpty()) {
      return;
    }
    returnReserved(player);
    deliverPending(player);
    refresh(player);
  }

  /** Forgets {@code player} (their state is already saved). */
  public void quit(UUID player) {
    generations.merge(player, 1L, Long::sum);
    loading.remove(player);
    departing.add(player);
    finishDeparture(player);
  }

  /** The loaded state of an online player. */
  public Optional<PlayerQuests> state(UUID player) {
    return departing.contains(player)
        ? Optional.empty()
        : Optional.ofNullable(sessions.get(player));
  }

  /** Every online player with loaded state. */
  public List<UUID> online() {
    return sessions.keySet().stream().filter(player -> !departing.contains(player)).toList();
  }

  /** The quest content. */
  public QuestContent content() {
    return wiring.content();
  }

  /** The quests {@code player} can see: the content's and their board's. */
  public Catalog catalog(UUID player) {
    return state(player).map(this::catalog).orElseGet(() -> wiring.content().catalog());
  }

  private Catalog catalog(PlayerQuests state) {
    var board = new ArrayList<Quest>();
    for (var entry : state.board().entries()) {
      var template =
          wiring
              .content()
              .template(entry.template())
              .orElseThrow(
                  () ->
                      new IllegalStateException(
                          "Stored board template no longer exists: " + entry.template()));
      board.add(BoardQuests.quest(template, entry, wiring.config().board().npc()));
    }
    return wiring.content().catalog().with(board);
  }

  private Optional<Context> context(UUID player, PlayerQuests state) {
    return wiring.world().facts(player).map(facts -> context(state, facts));
  }

  private Context context(PlayerQuests state, Facts facts) {
    return new Context(catalog(state), facts, wiring.time().instant(), wiring.config().calendar());
  }

  // ---- talking to NPCs -----------------------------------------------------------------------

  /** What {@code npc} says to {@code player} about quests, if anything. */
  public Optional<QuestDialogue> dialogue(UUID player, String npc) {
    var state = sessions.get(player);
    if (state == null) {
      return Optional.empty();
    }
    return context(player, state)
        .flatMap(
            context ->
                Dialogues.forNpc(
                    state,
                    new Dialogues.Npc(npc, wiring.npcNames().apply(npc)),
                    context,
                    wiring.config().labels()));
  }

  /** {@code player} accepts {@code quest} from {@code npc}. */
  public void accept(UUID player, String quest, String npc) {
    withContext(
        player,
        (state, context) -> {
          var found = context.catalog().quest(quest);
          if (found.isEmpty() || !found.get().giver().equals(npc)) {
            wiring.world().send(player, Notices.error("That quest isn't offered here."));
            return;
          }
          commitOrRefuse(player, state, QuestEngine.accept(state, quest, context), context);
        });
  }

  /** {@code player} accepts the first quest {@code npc} offers them. */
  public void acceptFirst(UUID player, String npc) {
    withContext(
        player,
        (state, context) ->
            context.catalog().all().stream()
                .filter(quest -> quest.giver().equals(npc))
                .filter(
                    quest ->
                        QuestEngine.availability(state, quest, context)
                            == QuestEngine.Availability.OFFERABLE)
                .findFirst()
                .ifPresentOrElse(
                    quest -> accept(player, quest.id(), npc),
                    () ->
                        wiring
                            .world()
                            .send(player, Notices.info("There's nothing to take on here."))));
  }

  /** {@code player} hands in at {@code npc}, for one quest or all. */
  public void handIn(UUID player, String npc, Optional<String> quest) {
    withContext(
        player,
        (state, context) -> {
          var outcome = QuestEngine.turnIn(state, npc, quest, context);
          if (!outcome.changed(state)) {
            wiring
                .world()
                .send(
                    player,
                    Notices.info(
                        wiring.npcNames().apply(npc) + " needs something you don't have yet."));
            return;
          }
          commit(player, state, outcome, context.catalog());
        });
  }

  /** {@code player} picks {@code option} of {@code quest}'s choice. */
  public void choose(UUID player, String quest, int option) {
    withContext(
        player,
        (state, context) ->
            commitOrRefuse(
                player, state, QuestEngine.choose(state, quest, option, context), context));
  }

  // ---- the journal ---------------------------------------------------------------------------

  /** {@code player} drops {@code quest}. */
  public void abandon(UUID player, String quest) {
    withContext(
        player,
        (state, context) ->
            commitOrRefuse(player, state, QuestEngine.abandon(state, quest, context), context));
  }

  /** Tracks {@code quest} in the sidebar, or stops tracking it if it already is. */
  public void track(UUID player, String quest) {
    withContext(
        player,
        (state, context) -> {
          if (state.active(quest).isEmpty()) {
            wiring.world().send(player, Notices.error("You don't have that quest."));
            return;
          }
          var tracked = state.tracked().filter(quest::equals).isPresent();
          var next = state.withTracked(tracked ? Optional.empty() : Optional.of(quest));
          commit(player, state, Outcome.unchanged(next), context.catalog());
          wiring
              .world()
              .send(
                  player,
                  Notices.info(
                      (tracked ? "Stopped tracking " : "Tracking ")
                          + Journal.name(context.catalog(), quest)
                          + "."));
        });
  }

  /** The journal for {@code player}. */
  public Optional<Journal.View> journal(UUID player) {
    return state(player)
        .map(state -> Journal.journal(state, catalog(state), lookup, wiring.content().factions()));
  }

  /** The players with the most quest points. */
  public CompletableFuture<List<QuestStore.Standing>> top() {
    return wiring.store().top(wiring.config().topSize());
  }

  // ---- events --------------------------------------------------------------------------------

  /**
   * {@code player} did something objectives may count. Kills and pickups are shared with {@code
   * nearby} players who have the same objective active.
   */
  public void event(UUID player, QuestEvent event, Collection<UUID> nearby) {
    apply(player, event);
    if (!event.shared()) {
      return;
    }
    for (var other : nearby) {
      var state = sessions.get(other);
      if (other.equals(player) || state == null) {
        continue;
      }
      var wants = context(other, state).filter(context -> QuestEngine.wants(state, event, context));
      if (wants.isPresent()) {
        apply(other, event);
      }
    }
  }

  private void apply(UUID player, QuestEvent event) {
    withContext(
        player,
        (state, context) ->
            commit(player, state, QuestEngine.handle(state, event, context), context.catalog()));
  }

  /** Re-checks every online player: board, held items, levels, time limits, markers, sidebar. */
  public void tick() {
    for (var player : List.copyOf(sessions.keySet())) {
      refresh(player);
    }
  }

  private void refresh(UUID player) {
    withContext(
        player,
        (state, context) -> {
          var drawn = drawBoard(player, state, context);
          var next = drawn.state();
          var outcome = QuestEngine.refresh(next, context(next, context.facts()));
          var effects = new ArrayList<>(drawn.effects());
          effects.addAll(outcome.effects());
          commit(player, state, new Outcome(outcome.state(), effects), context.catalog());
        });
  }

  /** Draws a new board if the day or week has turned, dropping expired board quests. */
  private Outcome drawBoard(UUID player, PlayerQuests state, Context context) {
    var board = wiring.config().board();
    var refreshed =
        BoardQuests.refresh(
            state.board(),
            context.now(),
            new BoardQuests.Pool(
                context.calendar(),
                wiring.content().templates(),
                board.dailies(),
                board.weeklies()),
            wiring.random());
    if (refreshed.board().equals(state.board())) {
      return Outcome.unchanged(state);
    }
    var next = state;
    var effects = new ArrayList<Effect>();
    for (var slot : refreshed.expired()) {
      if (next.active(slot).isPresent()) {
        var dropped = QuestEngine.abandon(next, slot, context);
        if (dropped instanceof Result.Ok<Outcome, Refusal>(var outcome)) {
          next = outcome.state();
          effects.addAll(outcome.effects());
        }
      }
    }
    wiring.logger().debug("Drew a new quest board for {}", player);
    return new Outcome(next.withBoard(refreshed.board()), effects);
  }

  // ---- administration ------------------------------------------------------------------------

  /** Forgets {@code quest} for {@code player}. */
  public Result<String, String> adminReset(UUID player, String quest) {
    return admin(
        player,
        quest,
        (state, context) -> Result.ok(QuestEngine.reset(state, quest, context)),
        "Reset ");
  }

  /** Completes {@code quest} for {@code player}, with rewards. */
  public Result<String, String> adminComplete(UUID player, String quest) {
    return admin(
        player,
        quest,
        (state, context) -> QuestEngine.complete(state, quest, context),
        "Completed ");
  }

  /** Puts {@code player} in {@code stage} of {@code quest}. */
  public Result<String, String> adminStage(UUID player, String quest, String stage) {
    return admin(
        player,
        quest,
        (state, context) -> QuestEngine.jump(state, quest, stage, context),
        "Moved to " + stage + ": ");
  }

  private interface AdminStep {
    Result<Outcome, Refusal> apply(PlayerQuests state, Context context);
  }

  private Result<String, String> admin(UUID player, String quest, AdminStep step, String done) {
    var state = sessions.get(player);
    if (state == null) {
      return Result.err("That player is not online or their quests have not loaded.");
    }
    var context = context(player, state);
    if (context.isEmpty()) {
      return Result.err("That player is not online.");
    }
    if (context.get().catalog().quest(quest).isEmpty()) {
      return Result.err("There is no quest " + quest + ".");
    }
    if (saving.containsKey(player)) {
      return Result.err("That player's quest progress is still saving. Try again.");
    }
    return switch (step.apply(state, context.get())) {
      case Result.Ok<Outcome, Refusal>(var outcome) -> {
        commit(player, state, outcome, context.get().catalog());
        yield Result.ok(done + quest);
      }
      case Result.Err<Outcome, Refusal>(var refusal) -> Result.err(refusal(refusal));
    };
  }

  // ---- hooks for other modules ---------------------------------------------------------------

  @Override
  public void progress(Player player, String hook, int amount) {
    if (amount > 0) {
      event(player.getUniqueId(), new QuestEvent.Hook(hook, amount), List.of());
    }
  }

  @Override
  public void onAction(String hook, CustomAction action) {
    if (customActions.putIfAbsent(hook, action) != null) {
      throw new IllegalStateException("custom quest action " + hook + " is already registered");
    }
  }

  @Override
  public boolean completed(Player player, String quest) {
    return state(player.getUniqueId()).flatMap(state -> state.completion(quest)).isPresent();
  }

  @Override
  public boolean active(Player player, String quest) {
    return state(player.getUniqueId()).flatMap(state -> state.active(quest)).isPresent();
  }

  @Override
  public long variable(Player player, String name) {
    return state(player.getUniqueId()).map(state -> state.variable(name)).orElse(0L);
  }

  @Override
  public long reputation(Player player, String faction) {
    return state(player.getUniqueId()).map(state -> state.reputation(faction)).orElse(0L);
  }

  @Override
  public long points(Player player) {
    return state(player.getUniqueId()).map(PlayerQuests::points).orElse(0L);
  }

  /** The custom action registered for {@code hook}. */
  Optional<CustomAction> customAction(String hook) {
    return Optional.ofNullable(customActions.get(hook));
  }

  // ---- committing ----------------------------------------------------------------------------

  private interface Step {
    void run(PlayerQuests state, Context context);
  }

  private void withContext(UUID player, Step step) {
    if (saving.containsKey(player)) {
      var facts = wiring.world().facts(player);
      if (facts.isEmpty()) {
        return;
      }
      var captured = facts.get();
      queued
          .computeIfAbsent(player, ignored -> new ArrayDeque<>())
          .addLast(() -> withContext(player, step, captured));
      return;
    }
    var state = sessions.get(player);
    if (state == null) {
      return;
    }
    context(player, state).ifPresent(context -> step.run(state, context));
  }

  private void withContext(UUID player, Step step, Facts facts) {
    if (saving.containsKey(player)) {
      queued
          .computeIfAbsent(player, ignored -> new ArrayDeque<>())
          .addLast(() -> withContext(player, step, facts));
      return;
    }
    var state = sessions.get(player);
    if (state != null) {
      step.run(state, context(state, facts));
    }
  }

  private void commitOrRefuse(
      UUID player, PlayerQuests state, Result<Outcome, Refusal> result, Context context) {
    switch (result) {
      case Result.Ok<Outcome, Refusal>(var outcome) ->
          commit(player, state, outcome, context.catalog());
      case Result.Err<Outcome, Refusal>(var refusal) ->
          wiring.world().send(player, Notices.error(refusal(refusal)));
    }
  }

  /**
   * Persists a changed state before exposing it or carrying out any effects. Player operations
   * arriving during the write are replayed in order against the persisted state.
   */
  private void commit(UUID player, PlayerQuests before, Outcome outcome, Catalog catalog) {
    var after = outcome.state();
    var reserved =
        outcome.effects().stream()
            .filter(Effect.World.class::isInstance)
            .map(Effect.World.class::cast)
            .map(Effect.World::action)
            .filter(Action.Take.class::isInstance)
            .map(Action.Take.class::cast)
            .toList();
    var pending =
        outcome.effects().stream()
            .filter(Effect.World.class::isInstance)
            .map(Effect.World.class::cast)
            .filter(effect -> !(effect.action() instanceof Action.Take))
            .map(
                effect ->
                    new PendingWorld(
                        new UUID(wiring.random().nextLong(), wiring.random().nextLong()),
                        player,
                        effect.quest(),
                        effect.action()))
            .toList();
    if (after.equals(before) && pending.isEmpty() && reserved.isEmpty()) {
      effects(player, outcome, catalog);
      present(player, after);
      return;
    }
    var taken = new ArrayList<QuestWorld.TakenItems>();
    for (var item : reserved) {
      var removed = wiring.world().take(player, item.item(), item.amount());
      if (removed.isEmpty()) {
        refund(player, taken);
        wiring.world().send(player, Notices.error("You no longer have the items to hand over."));
        return;
      }
      taken.add(removed.get());
    }
    var barrier = new CompletableFuture<Void>();
    saving.put(player, barrier);
    var _ =
        wiring
            .store()
            .save(after, pending)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  try {
                    if (failure != null) {
                      refund(player, taken);
                      wiring.logger().error("Could not save quests for {}", player, failure);
                      wiring
                          .world()
                          .send(
                              player,
                              Notices.error("Your quest progress could not be saved. Try again."));
                    } else {
                      if (sessions.containsKey(player)) {
                        sessions.put(player, after);
                      }
                      effects(player, outcome, catalog);
                      deliverPending(player);
                      present(player, after);
                    }
                  } finally {
                    saving.remove(player, barrier);
                    drain(player);
                    finishDeparture(player);
                    barrier.complete(null);
                  }
                },
                wiring.mainThread())
            .exceptionally(
                failure -> {
                  wiring.logger().error("Quest commit callback failed for {}", player, failure);
                  return null;
                });
  }

  private void effects(UUID player, Outcome outcome, Catalog catalog) {
    var executor = new EffectRunner(player, wiring, notices, this);
    for (var effect : outcome.effects()) {
      if (!(effect instanceof Effect.World) || effect instanceof Effect.World(_, Action.Take _)) {
        executor.run(effect, catalog);
      }
    }
  }

  private void refund(UUID player, List<QuestWorld.TakenItems> taken) {
    if (taken.isEmpty()) {
      return;
    }
    refunds.computeIfAbsent(player, ignored -> new ArrayList<>()).addAll(taken);
    returnReserved(player);
  }

  private void returnReserved(UUID player) {
    if (wiring.world().facts(player).isEmpty()) {
      return;
    }
    var items = refunds.remove(player);
    if (items != null) {
      for (var item : items) {
        wiring.world().restore(player, item);
      }
    }
  }

  /** Replays committed world actions in order, stopping at the first action that cannot run. */
  private void deliverPending(UUID player) {
    if (wiring.world().facts(player).isEmpty()) {
      return;
    }
    if (!delivering.add(player)) {
      deliveryRequested.add(player);
      return;
    }
    var _ =
        wiring
            .store()
            .pending(player)
            .whenCompleteAsync(
                (pending, failure) -> {
                  if (failure != null) {
                    wiring
                        .logger()
                        .error("Could not load pending quest actions for {}", player, failure);
                    finishDelivery(player);
                  } else {
                    deliverNext(player, pending, 0);
                  }
                },
                wiring.mainThread());
  }

  private void deliverNext(UUID player, List<PendingWorld> pending, int index) {
    if (index >= pending.size() || wiring.world().facts(player).isEmpty()) {
      finishDelivery(player);
      return;
    }
    var effect = pending.get(index);
    var runner = new EffectRunner(player, wiring, notices, this);
    CompletableFuture<Boolean> applied;
    try {
      applied = runner.world(effect.quest(), effect.action());
    } catch (RuntimeException failure) {
      wiring.logger().error("Could not deliver quest action {}", effect.id(), failure);
      finishDelivery(player);
      return;
    }
    var _ =
        applied.whenCompleteAsync(
            (success, failure) -> {
              if (failure != null || !Boolean.TRUE.equals(success)) {
                if (failure != null) {
                  wiring.logger().error("Quest action {} failed", effect.id(), failure);
                }
                finishDelivery(player);
                return;
              }
              var _ =
                  wiring
                      .store()
                      .acknowledge(effect.id())
                      .whenCompleteAsync(
                          (ignored, ackFailure) -> {
                            if (ackFailure != null) {
                              wiring
                                  .logger()
                                  .error(
                                      "Could not acknowledge quest action {}",
                                      effect.id(),
                                      ackFailure);
                              finishDelivery(player);
                              return;
                            }
                            runner.run(
                                new Effect.World(effect.quest(), effect.action()),
                                wiring.content().catalog());
                            deliverNext(player, pending, index + 1);
                          },
                          wiring.mainThread());
            },
            wiring.mainThread());
  }

  private void finishDelivery(UUID player) {
    delivering.remove(player);
    if (deliveryRequested.remove(player)) {
      deliverPending(player);
    }
  }

  private void drain(UUID player) {
    var actions = queued.get(player);
    while (actions != null && !actions.isEmpty() && !saving.containsKey(player)) {
      actions.removeFirst().run();
    }
    if (actions != null && actions.isEmpty()) {
      queued.remove(player);
    }
  }

  private void finishDeparture(UUID player) {
    if (departing.contains(player) && !saving.containsKey(player) && !queued.containsKey(player)) {
      sessions.remove(player);
      departing.remove(player);
    }
  }

  private void present(UUID player, PlayerQuests state) {
    var facts = wiring.world().facts(player);
    if (facts.isEmpty()) {
      return;
    }
    var context = context(state, facts.get());
    wiring.world().markers(player, Markers.compute(state, context, Markers.npcs(state, context)));
    wiring
        .world()
        .sidebar(
            player,
            Journal.sidebar(state, context.catalog(), lookup, wiring.config().sidebarLines()));
  }

  static String refusal(Refusal refusal) {
    return switch (refusal) {
      case UNKNOWN_QUEST -> "There is no such quest.";
      case ALREADY_ACTIVE -> "You are already on that quest.";
      case NOT_REPEATABLE_YET -> "You can't take that quest again yet.";
      case REQUIREMENTS_UNMET -> "You aren't ready for that quest yet.";
      case NOT_ACTIVE -> "You don't have that quest.";
      case NOT_CHOOSING -> "There's nothing to decide on that quest right now.";
      case UNKNOWN_OPTION -> "That isn't one of the choices.";
      case UNKNOWN_STAGE -> "That quest has no such stage.";
    };
  }
}
