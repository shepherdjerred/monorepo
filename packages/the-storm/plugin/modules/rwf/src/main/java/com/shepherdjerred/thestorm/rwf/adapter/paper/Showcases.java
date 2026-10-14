package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ShowcaseStart;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Reserves bot-only starts, waiting for the selected map's terrain and navigation before drafting.
 */
final class Showcases {
  private final MatchRunner runner;
  private final PaperContext context;
  private final Bots bots;
  private final BotArrivals arrivals;
  private final int maximum;
  private OptionalInt count = OptionalInt.empty();
  private int generation;
  private @Nullable Pending pending;

  private record Pending(int generation, UUID matchId, List<CombatantId> members) {}

  record Parts(PaperContext context, Bots bots, BotArrivals arrivals, int maximum) {}

  Showcases(MatchRunner runner, Parts parts) {
    this.runner = runner;
    this.context = parts.context();
    this.bots = parts.bots();
    this.arrivals = parts.arrivals();
    this.maximum = parts.maximum();
  }

  OptionalInt count() {
    return count;
  }

  boolean preparing() {
    return pending != null;
  }

  Optional<String> prepare(UUID lobbyId) {
    if (!runner.match().matchId().equals(lobbyId)) {
      return Optional.of("The requested showcase lobby is no longer current.");
    }
    if (!runner.ready() || !(runner.match().phase() instanceof Phase.Lobby)) {
      return Optional.of("Map preparation requires an open lobby.");
    }
    if (count.isPresent() || !runner.match().members().isEmpty()) {
      return Optional.of("Map preparation requires an empty lobby without a showcase.");
    }
    return runner.handle(new MatchEvent.CloseVote()).map(Texts::describe);
  }

  Optional<String> start(int size) {
    var refusal = refusal(size);
    return refusal.isPresent() ? refusal : begin(size);
  }

  Optional<String> startSeeded(UUID lobbyId, int size, long seed) {
    if (!runner.match().matchId().equals(lobbyId)) {
      return Optional.of("The requested showcase lobby is no longer current.");
    }
    var refusal = refusal(size);
    if (refusal.isPresent()) return refusal;
    if (!runner.match().members().isEmpty()) {
      return Optional.of("A seeded showcase requires an empty lobby.");
    }
    var previous = runner.match();
    var previousTime = context.mapWorld().getTime();
    runner.reseedShowcase(seed);
    var refused = begin(size);
    if (refused.isPresent()) runner.restoreShowcase(previous, previousTime);
    return refused;
  }

  private Optional<String> refusal(int size) {
    return new ShowcaseStart(
            maximum,
            runner.ready(),
            bots.roster().isPresent(),
            count.isPresent(),
            runner.humans(),
            runner.match().phase() instanceof Phase.Lobby)
        .refusal(size);
  }

  private Optional<String> begin(int size) {
    count = OptionalInt.of(size);
    pending = new Pending(++generation, runner.match().matchId(), members());
    if (ready()) return fill();
    var refusal = runner.handle(new MatchEvent.CloseVote()).map(Texts::describe);
    if (refusal.isPresent()) reset();
    return refusal;
  }

  private boolean ready() {
    return runner.match().map().isPresent()
        && runner.currentMap().filter(MapWorld::ready).isPresent();
  }

  private List<CombatantId> members() {
    return runner.match().members().stream().map(Combatant::id).toList();
  }

  void after(MatchEvent event) {
    if (pending == null) return;
    switch (event) {
      case MatchEvent.MapReady _ -> complete();
      case MatchEvent.Stop _,
          MatchEvent.SetMap _,
          MatchEvent.MapQuarantined _,
          MatchEvent.MapFailed _ -> {
        context.logger().warn("rwf showcase start was cancelled before map activation completed");
        reset();
      }
      default -> {}
    }
  }

  private void complete() {
    var request = pending;
    if (request == null) return;
    if (request.generation() != generation
        || !request.matchId().equals(runner.match().matchId())
        || !(runner.match().phase() instanceof Phase.Lobby)
        || !request.members().equals(members())
        || runner.humans() != 0
        || !ready()) {
      reset();
      return;
    }
    fill()
        .ifPresent(
            error -> {
              context.logger().error("rwf showcase start failed: {}", error);
              runner.handle(new MatchEvent.Stop());
            });
  }

  private Optional<String> fill() {
    var size = count.orElseThrow();
    runner.joinBots(size - runner.match().members().size());
    pending = null;
    if (runner.match().members().isEmpty()) {
      reset();
      return Optional.of("No bot could be spawned for the showcase; see the log.");
    }
    context.logger().info("rwf match {} is a showcase of {}", runner.match().matchId(), size);
    return Optional.empty();
  }

  Optional<String> stop(UUID matchId) {
    if (!runner.match().matchId().equals(matchId) || count.isEmpty() || runner.humans() > 0) {
      return Optional.of("No bots-only showcase with that id is running.");
    }
    if (!(runner.match().phase() instanceof Phase.Ended)
        && !(runner.match().phase() instanceof Phase.Resetting)) {
      return runner.handle(new MatchEvent.Stop()).map(Object::toString);
    }
    return Optional.empty();
  }

  void reset() {
    cancel();
    count = OptionalInt.empty();
  }

  void cancel() {
    generation++;
    pending = null;
    arrivals.release();
  }
}
