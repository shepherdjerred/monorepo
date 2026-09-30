package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.app.QuestStore.PendingWorld;
import com.shepherdjerred.thestorm.quests.app.QuestStore.Status;
import com.shepherdjerred.thestorm.quests.domain.board.BoardQuests;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.Collections;
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
import com.shepherdjerred.thestorm.quests.domain.state.Board;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import com.shepherdjerred.thestorm.quests.domain.storylet.Storylets;
import com.shepherdjerred.thestorm.quests.domain.view.Describe;
import com.shepherdjerred.thestorm.quests.domain.view.Dialogues;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import com.shepherdjerred.thestorm.quests.domain.view.Markers;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue;
import java.time.Instant;
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
import org.jspecify.annotations.Nullable;

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
   * @param collections authored first-pickup discoveries
   * @param config quests.yml
   * @param store where state is kept
   * @param world the server
   * @param rewards pays crystals and grants permissions
   * @param npcNames an NPC id to its display name
   * @param mainThread completes futures back on the main thread
   * @param time the clock
   * @param random draws board quests from the host-provided generator
   * @param logger the module logger
   */
  public record Wiring(
      QuestContent content,
      Collections collections,
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
  private final QuestTextRenderer textRenderer;
  private final Map<UUID, PlayerQuests> sessions = new HashMap<>();
  private final Map<UUID, CompletableFuture<Void>> loading = new HashMap<>();
  private final Map<UUID, CompletableFuture<Void>> saving = new HashMap<>();
  private final Map<UUID, Set<String>> deferredDiscoveries = new HashMap<>();
  private final Map<UUID, ArrayDeque<Runnable>> queued = new HashMap<>();
  private final Map<UUID, Long> generations = new HashMap<>();
  private final Set<UUID> departing = new HashSet<>();
  private final Set<UUID> delivering = new HashSet<>();
  private final Set<UUID> deliveryRequested = new HashSet<>();
  private final Map<UUID, Set<UUID>> pendingHandins = new HashMap<>();
  private final Set<UUID> handinNoticeSent = new HashSet<>();
  private final Map<UUID, DeferredNotices> deferredNotices = new HashMap<>();
  private final Map<String, CustomAction> customActions = new HashMap<>();

  public QuestService(Wiring wiring) {
    this(wiring, (source, state, context) -> source);
  }

  /** Wires optional authored dialogue rendering into the existing quest graph. */
  public QuestService(Wiring wiring, QuestTextRenderer textRenderer) {
    this.wiring = wiring;
    this.textRenderer = textRenderer;
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
            .thenCombine(wiring.store().pending(player), Loaded::new)
            .thenAcceptAsync(
                loaded -> {
                  if (generations.getOrDefault(player, 0L) != generation) {
                    return;
                  }
                  loading.remove(player);
                  if (wiring.world().facts(player).isEmpty()) {
                    return;
                  }
                  pendingHandins.put(player, handins(loaded.pending()));
                  handinNoticeSent.remove(player);
                  sessions.put(player, loaded.state());
                  deliverPending(player);
                  flushDiscoveries(player);
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
    deliverPending(player);
    flushDiscoveries(player);
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
    return departing.contains(player) || handoverPending(player)
        ? Optional.empty()
        : Optional.ofNullable(sessions.get(player));
  }

  /** Whether a committed item hand-in has not yet been delivered or reconciled. */
  public boolean handoverPending(UUID player) {
    return !pendingHandins.getOrDefault(player, Set.of()).isEmpty();
  }

  private record Loaded(PlayerQuests state, List<PendingWorld> pending) {}

  private record DeferredNotices(Outcome outcome, Catalog catalog) {}

  private record PendingCommit(Outcome outcome, List<PendingWorld> pending, Catalog catalog) {}

  private static Set<UUID> handins(List<PendingWorld> pending) {
    var ids = new HashSet<UUID>();
    pending.stream()
        .filter(effect -> effect.action() instanceof Action.Take)
        .map(PendingWorld::id)
        .forEach(ids::add);
    return ids;
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
    if (handoverPending(player)) {
      return Optional.empty();
    }
    var state = sessions.get(player);
    if (state == null) {
      return Optional.empty();
    }
    var current = context(player, state);
    if (current.isEmpty()) {
      return Optional.empty();
    }
    if (npc.equals(wiring.config().board().npc()) && boardExpired(state, current.get().now())) {
      refresh(player);
      wiring
          .world()
          .send(player, Notices.info("The quest board has changed. Talk again for new offers."));
      return Optional.empty();
    }
    return Dialogues.forNpc(
            state,
            new Dialogues.Npc(npc, wiring.npcNames().apply(npc)),
            current.get(),
            wiring.config().labels())
        .map(dialogue -> render(dialogue, state, current.get()));
  }

  private QuestDialogue render(QuestDialogue dialogue, PlayerQuests state, Context context) {
    var nodes = new HashMap<String, QuestDialogue.Node>();
    dialogue
        .nodes()
        .forEach(
            (id, node) ->
                nodes.put(
                    id,
                    new QuestDialogue.Node(
                        textRenderer.render(node.text(), state, context), node.options())));
    return new QuestDialogue(dialogue.title(), dialogue.start(), nodes);
  }

  /** {@code player} accepts {@code quest} from {@code npc}. */
  public void accept(UUID player, String quest, String npc) {
    var current = sessions.get(player);
    var offered = current == null ? Board.EMPTY : current.board();
    withContext(
        player,
        (state, context) -> {
          if (offered.entry(quest).isPresent() && !offered.equals(state.board())) {
            wiring
                .world()
                .send(player, Notices.info("The quest board has changed. Check its new offers."));
            return;
          }
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
    var boardNpc = npc.equals(wiring.config().board().npc());
    var current = sessions.get(player);
    var offered = current == null ? Board.EMPTY : current.board();
    withContext(
        player,
        (state, context) -> {
          if (boardNpc && !offered.equals(state.board())) {
            wiring
                .world()
                .send(player, Notices.info("The quest board has changed. Check its new offers."));
            return;
          }
          Storylets.offers(state, npc, context, 1).stream()
              .findFirst()
              .ifPresentOrElse(
                  quest -> accept(player, quest.id(), npc),
                  () ->
                      wiring
                          .world()
                          .send(player, Notices.info("There's nothing to take on here.")));
        });
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
    var loaded = state(player);
    if (loaded.isEmpty()) {
      return Optional.empty();
    }
    var state = loaded.get();
    if (boardExpired(state, wiring.time().instant())) {
      refresh(player);
      return Optional.empty();
    }
    return Optional.of(
        Journal.journal(
            state,
            catalog(state),
            lookup,
            new Journal.Content(
                wiring.content().factions(),
                wiring.collections(),
                wiring.content().quests().keySet())));
  }

  /** Reveals authored collection entries after an eligible main-world pickup. */
  public void discover(UUID player, String material) {
    var matching = wiring.collections().matching(material);
    if (matching.isEmpty()) {
      return;
    }
    if (loading.containsKey(player)
        || state(player).isEmpty()
        || wiring.world().facts(player).isEmpty()) {
      deferredDiscoveries.computeIfAbsent(player, ignored -> new HashSet<>()).add(material);
      if (!loading.containsKey(player)
          && !sessions.containsKey(player)
          && wiring.world().facts(player).isPresent()) {
        var _ = join(player);
      }
      return;
    }
    withContext(
        player,
        (state, context) -> {
          var next = state;
          var effects = new ArrayList<Effect>();
          for (var entry : matching) {
            if (!next.discoveries().containsKey(entry.id())) {
              next = next.discover(entry.id(), wiring.time().instant());
              effects.add(new Effect.Discovered(entry.name()));
            }
          }
          if (!effects.isEmpty()) {
            commit(player, state, new Outcome(next, effects), context.catalog());
          }
        });
  }

  private void flushDiscoveries(UUID player) {
    if (state(player).isEmpty() || wiring.world().facts(player).isEmpty()) {
      return;
    }
    var materials = deferredDiscoveries.remove(player);
    if (materials != null) {
      materials.forEach(material -> discover(player, material));
    }
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

  /** Re-checks held items, levels, time limits, markers and sidebars for online players. */
  public void tick() {
    for (var player : List.copyOf(sessions.keySet())) {
      withContext(
          player,
          (state, context) ->
              commit(player, state, QuestEngine.refresh(state, context), context.catalog()),
          false);
    }
  }

  private void refresh(UUID player) {
    refresh(player, null);
  }

  private void refresh(UUID player, @Nullable Runnable afterSave) {
    withContext(
        player,
        (state, context) -> {
          var drawn = drawBoard(player, state, context);
          var next = drawn.state();
          var nextContext =
              new Context(catalog(next), context.facts(), context.now(), context.calendar());
          var outcome = QuestEngine.refresh(next, nextContext);
          var effects = new ArrayList<>(drawn.effects());
          effects.addAll(outcome.effects());
          commit(
              player,
              state,
              new Save(new Outcome(outcome.state(), effects), context.catalog(), afterSave));
        },
        false);
  }

  private boolean boardExpired(PlayerQuests state, Instant now) {
    var calendar = wiring.config().calendar();
    return !state.board().day().equals(calendar.day(now).toString())
        || !state.board().week().equals(calendar.week(now).toString());
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
    if (handoverPending(player)) {
      return Result.err("That player has an unfinished item hand-in. Reconcile it first.");
    }
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

  /** Pending and in-doubt world effects for operator reconciliation. */
  public CompletableFuture<List<PendingWorld>> pendingWorld(UUID player) {
    return wiring.store().pending(player);
  }

  /** Replays only after an operator confirms the prior attempt had no side effect. */
  public CompletableFuture<Boolean> retryWorld(UUID player, UUID effect) {
    if (delivering.contains(player)) {
      return CompletableFuture.failedFuture(
          new IllegalStateException("quest delivery is in progress"));
    }
    return wiring
        .store()
        .retry(player, effect)
        .thenApplyAsync(
            changed -> {
              if (changed) {
                deliverPending(player);
              }
              return changed;
            },
            wiring.mainThread());
  }

  /** Advances past an action an operator confirms was already delivered. */
  public CompletableFuture<Boolean> completeWorld(UUID player, UUID effect) {
    if (delivering.contains(player)) {
      return CompletableFuture.failedFuture(
          new IllegalStateException("quest delivery is in progress"));
    }
    return wiring
        .store()
        .complete(player, effect)
        .thenApplyAsync(
            changed -> {
              if (changed) {
                handinResolved(player, effect);
                deliverPending(player);
              }
              return changed;
            },
            wiring.mainThread());
  }

  // ---- committing ----------------------------------------------------------------------------

  private interface Step {
    void run(PlayerQuests state, Context context);
  }

  private void handinResolved(UUID player, UUID effect) {
    var pending = pendingHandins.get(player);
    if (pending != null && pending.remove(effect) && pending.isEmpty()) {
      pendingHandins.remove(player);
      handinNoticeSent.remove(player);
      var notices = deferredNotices.remove(player);
      if (notices != null) {
        effects(player, notices.outcome(), notices.catalog());
      }
      var state = sessions.get(player);
      if (state != null && wiring.world().facts(player).isPresent()) {
        flushDiscoveries(player);
        present(player, state);
      }
    }
  }

  private boolean blockedByHandin(UUID player) {
    if (!handoverPending(player)) {
      return false;
    }
    if (handinNoticeSent.add(player)) {
      wiring
          .world()
          .send(player, Notices.info("Your item hand-in is awaiting delivery or staff review."));
    }
    return true;
  }

  private void withContext(UUID player, Step step) {
    withContext(player, step, true);
  }

  private void withContext(UUID player, Step step, boolean requireCurrentBoard) {
    if (blockedByHandin(player)) {
      return;
    }
    if (saving.containsKey(player)) {
      var facts = wiring.world().facts(player);
      if (facts.isEmpty()) {
        return;
      }
      var captured = facts.get();
      queued
          .computeIfAbsent(player, ignored -> new ArrayDeque<>())
          .addLast(() -> withContext(player, step, requireCurrentBoard, captured));
      return;
    }
    var state = sessions.get(player);
    if (state == null) {
      return;
    }
    context(player, state)
        .ifPresent(
            context -> {
              if (requireCurrentBoard && boardExpired(state, context.now())) {
                refresh(
                    player, () -> withContext(player, step, requireCurrentBoard, context.facts()));
              } else {
                step.run(state, context);
              }
            });
  }

  private void withContext(UUID player, Step step, boolean requireCurrentBoard, Facts facts) {
    if (blockedByHandin(player)) {
      return;
    }
    if (saving.containsKey(player)) {
      queued
          .computeIfAbsent(player, ignored -> new ArrayDeque<>())
          .addLast(() -> withContext(player, step, requireCurrentBoard, facts));
      return;
    }
    var state = sessions.get(player);
    if (state != null) {
      var context = context(state, facts);
      if (requireCurrentBoard && boardExpired(state, context.now())) {
        refresh(player, () -> withContext(player, step, requireCurrentBoard, facts));
      } else {
        step.run(state, context);
      }
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
    commit(player, before, new Save(outcome, catalog, null));
  }

  private record Save(Outcome outcome, Catalog catalog, @Nullable Runnable afterSave) {}

  private void commit(UUID player, PlayerQuests before, Save save) {
    var outcome = save.outcome();
    var catalog = save.catalog();
    var afterSave = save.afterSave();
    var after = outcome.state();
    var pending =
        outcome.effects().stream()
            .filter(Effect.World.class::isInstance)
            .map(Effect.World.class::cast)
            .map(
                effect ->
                    new PendingWorld(
                        new UUID(wiring.random().nextLong(), wiring.random().nextLong()),
                        player,
                        effect.quest(),
                        effect.action()))
            .toList();
    if (after.equals(before) && pending.isEmpty()) {
      effects(player, outcome, catalog);
      present(player, after);
      if (afterSave != null) {
        afterSave.run();
      }
      return;
    }
    pendingHandins.computeIfAbsent(player, ignored -> new HashSet<>()).addAll(handins(pending));
    var barrier = new CompletableFuture<Void>();
    saving.put(player, barrier);
    var _ =
        wiring
            .store()
            .save(after, pending)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  var persisted = false;
                  try {
                    persisted = failure == null;
                    saved(player, new PendingCommit(outcome, pending, catalog), failure);
                  } finally {
                    saving.remove(player, barrier);
                    if (persisted && afterSave != null) {
                      queued
                          .computeIfAbsent(player, ignoredPlayer -> new ArrayDeque<>())
                          .addFirst(afterSave);
                    }
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

  private void saved(UUID player, PendingCommit committed, Throwable failure) {
    if (failure != null) {
      handins(committed.pending()).forEach(id -> handinResolved(player, id));
      wiring.logger().error("Could not save quests for {}", player, failure);
      wiring
          .world()
          .send(player, Notices.error("Your quest progress could not be saved. Try again."));
      return;
    }
    if (sessions.containsKey(player)) {
      sessions.put(player, committed.outcome().state());
    }
    if (handoverPending(player)) {
      deferredNotices.put(player, new DeferredNotices(committed.outcome(), committed.catalog()));
    } else {
      effects(player, committed.outcome(), committed.catalog());
    }
    deliverPending(player);
    if (!handoverPending(player)) {
      present(player, committed.outcome().state());
    }
  }

  private void effects(UUID player, Outcome outcome, Catalog catalog) {
    var executor = new EffectRunner(player, wiring, notices, this);
    var context = context(player, outcome.state());
    for (var effect : outcome.effects()) {
      if (!(effect instanceof Effect.World)) {
        if (effect instanceof Effect.Say(var npc, var text)) {
          context.ifPresent(
              current ->
                  executor.run(
                      new Effect.Say(npc, textRenderer.render(text, outcome.state(), current)),
                      catalog));
        } else {
          executor.run(effect, catalog);
        }
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
    if (effect.status() == Status.IN_DOUBT && effect.action() instanceof Action.Crystals) {
      // The economy ledger owns this stable effect ID; transferOnce can safely confirm or retry.
      deliverClaimed(player, pending, index);
      return;
    }
    if (effect.status() == Status.IN_DOUBT) {
      wiring
          .logger()
          .error(
              "Quest action {} for player {} is IN_DOUBT; inspect and reconcile before replay",
              effect.id(),
              player);
      wiring
          .world()
          .send(player, Notices.error("A quest reward needs staff review before it can continue."));
      finishDelivery(player);
      return;
    }
    var _ =
        wiring
            .store()
            .claim(effect.id())
            .whenCompleteAsync(
                (claimed, failure) -> {
                  if (failure != null || !Boolean.TRUE.equals(claimed)) {
                    wiring.logger().error("Could not claim quest action {}", effect.id(), failure);
                    finishDelivery(player);
                    return;
                  }
                  deliverClaimed(player, pending, index);
                },
                wiring.mainThread());
  }

  private void deliverClaimed(UUID player, List<PendingWorld> pending, int index) {
    var effect = pending.get(index);
    if (wiring.world().facts(player).isEmpty()) {
      finishDelivery(player);
      return;
    }
    var runner = new EffectRunner(player, wiring, notices, this);
    CompletableFuture<Boolean> applied;
    try {
      applied = runner.world(effect.id(), effect.quest(), effect.action());
    } catch (RuntimeException failure) {
      wiring.logger().error("Could not deliver quest action {}", effect.id(), failure);
      wiring.world().send(player, Notices.error("A quest reward needs staff review."));
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
                wiring.world().send(player, Notices.error("A quest reward needs staff review."));
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
                              wiring
                                  .world()
                                  .send(
                                      player, Notices.error("A quest reward needs staff review."));
                              finishDelivery(player);
                              return;
                            }
                            runner.run(
                                new Effect.World(effect.quest(), effect.action()),
                                wiring.content().catalog());
                            handinResolved(player, effect.id());
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
