package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.app.store.StreakStore;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.entity.Player;

/** Main-thread selection cache with guarded, asynchronous reads and writes through its app port. */
final class StreakPicker {
  private final MatchRunner runner;
  private final PaperContext context;
  private final StreakStore store;
  private final JoinGate gate;
  private final Map<UUID, StreakLoadout> loaded = new HashMap<>();
  private final Map<UUID, Read> loading = new HashMap<>();
  private final Set<UUID> failed = new HashSet<>();
  private final Map<UUID, CompletableFuture<Void>> saving = new HashMap<>();
  private long readGeneration;

  private record Admission(UUID matchId, Runnable retry) {}

  private record Read(
      long generation,
      CompletableFuture<Optional<StreakLoadout>> future,
      Optional<Admission> admission) {}

  StreakPicker(MatchRunner runner, PaperContext context, StreakStore store, JoinGate gate) {
    this.runner = runner;
    this.context = context;
    this.store = store;
    this.gate = gate;
  }

  Optional<String> admission(Player player, Runnable retry) {
    var id = player.getUniqueId();
    if (loaded.containsKey(id)) return Optional.empty();
    if (failed.contains(id))
      return Optional.of(
          "Your killstreak preferences could not be loaded. Reconnect after they are repaired.");
    var pending = loading.get(id);
    if (pending == null) beginRead(player, retry);
    else loading.put(id, new Read(pending.generation(), pending.future(), admissionIntent(retry)));
    return Optional.of("Loading your killstreak preferences; joining when ready.");
  }

  private void beginRead(Player player, Runnable retry) {
    var id = player.getUniqueId();
    readGeneration = Math.incrementExact(readGeneration);
    var read = new Read(readGeneration, store.load(id), admissionIntent(retry));
    loading.put(id, read);
    context.onMain(
        read.future(),
        preferences -> readComplete(player, read, preferences),
        () -> readFailed(player, read),
        "load killstreak preferences");
  }

  private void readComplete(Player player, Read read, Optional<StreakLoadout> preferences) {
    var id = player.getUniqueId();
    var current = completedRead(id, read);
    if (current.isEmpty() || !player.isOnline()) return;
    loaded.put(id, preferences.orElse(StreakLoadout.DEFAULT));
    current.orElseThrow().admission().ifPresent(request -> resume(id, request));
  }

  private Optional<Admission> admissionIntent(Runnable retry) {
    return Optional.of(new Admission(runner.match().matchId(), retry));
  }

  private void resume(UUID player, Admission request) {
    if (runner.match().matchId().equals(request.matchId()) && runner.memberOf(player).isEmpty())
      request.retry().run();
  }

  /** Watching takes snapshot ownership; a previous ordinary join must not recover that snapshot. */
  void suspendAdmission(UUID player) {
    loading.computeIfPresent(
        player, (_, read) -> new Read(read.generation(), read.future(), Optional.empty()));
  }

  private void readFailed(Player player, Read read) {
    var id = player.getUniqueId();
    if (completedRead(id, read).isEmpty()) return;
    failed.add(id);
    if (player.isOnline())
      Texts.error(player, "Your killstreak preferences could not be loaded; you were not joined.");
  }

  /** A reused read belongs to its latest admission intent, unless that future was invalidated. */
  private Optional<Read> completedRead(UUID player, Read finished) {
    var current = loading.get(player);
    if (current == null || current.generation() != finished.generation()) return Optional.empty();
    loading.remove(player);
    return Optional.of(current);
  }

  void restore(Player player) {
    var loadout = loaded.get(player.getUniqueId());
    if (loadout == null)
      throw new IllegalStateException("admitted player has no loaded streak preferences");
    if (runner.match().phase().kitsOpen()) {
      runner
          .handle(new MatchEvent.PickStreaks(new CombatantId.Human(player.getUniqueId()), loadout))
          .ifPresent(error -> Texts.error(player, error));
    }
  }

  private boolean choosing(Player player, UUID matchId) {
    return player.isOnline()
        && runner.match().matchId().equals(matchId)
        && runner.memberOf(player.getUniqueId()).isPresent()
        && runner.match().phase().kitsOpen();
  }

  void open(Player player) {
    var matchId = runner.match().matchId();
    if (!choosing(player, matchId)) {
      Texts.error(player, "Choose killstreaks after joining, before the round starts.");
      return;
    }
    context.onMain(
        gate.allows(player.getUniqueId()),
        allowed -> {
          if (!choosing(player, matchId)) return;
          if (!allowed) {
            Texts.error(player, "Killstreaks are not available to you.");
            return;
          }
          var selected =
              runner.memberOf(player.getUniqueId()).map(Combatant::streaks).orElseThrow();
          StreakMenu.open(context.server(), player, selected);
        },
        "open killstreak selection");
  }

  void select(Player player, StreakLoadout loadout) {
    var matchId = runner.match().matchId();
    if (!choosing(player, matchId)) {
      Texts.error(player, "Choose killstreaks after joining, before the round starts.");
      return;
    }
    context.onMain(
        gate.allows(player.getUniqueId()),
        allowed -> {
          if (!choosing(player, matchId)) return;
          if (!allowed) {
            Texts.error(player, "Killstreaks are not available to you.");
            return;
          }
          persist(player, matchId, loadout);
        },
        "check killstreak selection access");
  }

  private void persist(Player player, UUID matchId, StreakLoadout loadout) {
    var id = player.getUniqueId();
    if (saving.containsKey(id)) {
      Texts.info(player, "Your killstreak selection is still being saved.");
      return;
    }
    var future = store.save(id, loadout);
    saving.put(id, future);
    context.onMain(
        future,
        _ -> {
          if (!saving.remove(id, future)) return;
          if (!player.isOnline() || runner.memberOf(id).isEmpty()) return;
          loaded.put(id, loadout);
          if (choosing(player, matchId)) {
            runner
                .handle(new MatchEvent.PickStreaks(new CombatantId.Human(id), loadout))
                .ifPresent(error -> Texts.error(player, error));
            Texts.success(player, "Killstreak selection saved for this round.");
          } else {
            Texts.info(
                player,
                "Killstreak selection saved for your next round; this life keeps its rewards.");
          }
          if (player.getOpenInventory().getTopInventory().getHolder() instanceof StreakMenu)
            player.closeInventory();
        },
        () -> {
          if (saving.remove(id, future) && player.isOnline())
            Texts.error(
                player, "Your killstreak selection could not be saved; it has not changed.");
        },
        "save killstreak preferences");
  }

  void forget(UUID player) {
    loaded.remove(player);
    loading.remove(player);
    saving.remove(player);
    failed.remove(player);
  }
}
