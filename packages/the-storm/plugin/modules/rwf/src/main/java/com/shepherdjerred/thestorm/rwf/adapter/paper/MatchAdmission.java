package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** Admission and snapshot ownership for humans joining the match, including existing watchers. */
final class MatchAdmission {
  private final MatchRunner runner;
  private final PaperContext context;
  private final Snapshots snapshots;
  private @Nullable UUID keepingSnapshot;

  MatchAdmission(MatchRunner runner, PaperContext context, Snapshots snapshots) {
    this.runner = runner;
    this.context = context;
    this.snapshots = snapshots;
  }

  Optional<String> admit(Player player) {
    Runnable retry = () -> admit(player).ifPresent(error -> Texts.error(player, error));
    var refusal =
        admission(player)
            .or(() -> runner.streakPicker().admission(player, retry))
            .or(() -> snapshotRefusal(player, retry));
    return refusal.isPresent() ? refusal : join(player);
  }

  /** A watcher keeps the belongings already captured when they started watching. */
  Optional<String> admitWatcher(Player player) {
    var refusal = admission(player).or(() -> runner.streakPicker().admission(player, () -> {}));
    if (refusal.isPresent()) return refusal;
    keepingSnapshot = player.getUniqueId();
    try {
      return join(player);
    } finally {
      keepingSnapshot = null;
    }
  }

  private Optional<String> join(Player player) {
    var refused =
        runner
            .handle(
                new MatchEvent.Join(
                    new CombatantId.Human(player.getUniqueId()), player.getName(), runner.now()))
            .map(Texts::describe);
    if (refused.isEmpty()) {
      runner.streakPicker().restore(player);
      runner.picker().load(player.getUniqueId());
    }
    return refused;
  }

  private Optional<String> admission(Player player) {
    if (!runner.ready()) {
      return Optional.of("The match is still being prepared; try again in a moment.");
    }
    if (runner.memberOf(player.getUniqueId()).isPresent()) {
      return Optional.of(Texts.describe(MatchError.ALREADY_JOINED));
    }
    if (runner.showcase()) {
      return Optional.of("This match is a bot showcase; watch it with /rwf spectate.");
    }
    return Optional.empty();
  }

  /** Retries after cleanup confirmation; recovery must precede any replacement snapshot. */
  Optional<String> snapshotRefusal(Player player, Runnable retry) {
    return snapshots
        .refusal(player.getUniqueId())
        .map(
            refusal ->
                switch (refusal) {
                  case NOT_LOADED -> "The match is still starting up; try again in a moment.";
                  case CLEANUP_PENDING -> {
                    snapshots.whenClean(
                        player.getUniqueId(),
                        () -> {
                          if (player.isOnline()) retry.run();
                        });
                    yield "Your belongings from your last match are still being saved; trying again in a moment.";
                  }
                  case CLEANUP_STALLED ->
                      "Your restored belongings could not be confirmed as saved. Reconnect to finish recovery.";
                  case RESTORE_PENDING -> {
                    snapshots.recoverWhileOnline(player);
                    yield "Your belongings from your last match were restored first; try again.";
                  }
                });
  }

  void capture(CombatantId id) {
    if (!(id instanceof CombatantId.Human human) || human.uuid().equals(keepingSnapshot)) return;
    var player = context.server().getPlayer(human.uuid());
    if (player == null) {
      runner.handle(new MatchEvent.Leave(id, runner.now()));
      return;
    }
    snapshots.capture(
        player,
        stored -> {
          if (!stored) {
            Texts.error(player, "Your belongings could not be saved, so you were not let in.");
            runner.handle(new MatchEvent.Leave(id, runner.now()));
          }
        });
  }
}
