package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.snapshot.PlayerStates;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotKeeper;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.GameMode;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

/**
 * Players watching the match without playing it. Watching snapshots the player through the same
 * crash-safe keeper members use (under {@link Snapshots#WATCH_SCOPE}), then puts them in spectator
 * mode at the map's spectator point with the match board. Watchers are never members: the match,
 * its humans rule and its payouts never see them. They stay through every phase, move to each new
 * map's spectator point, and are restored on {@code /rwf leave}, on quitting and when the module
 * stops; a crash's snapshot comes back on their next login, as a member's does. Main thread only.
 */
final class Watchers {

  private final MatchRunner runner;
  private final Snapshots snapshots;
  private final Scoreboards boards;
  private final PaperContext context;
  private final Set<UUID> watching = new LinkedHashSet<>();
  private final Set<UUID> saving = new HashSet<>();

  Watchers(MatchRunner runner, Snapshots snapshots, Scoreboards boards, PaperContext context) {
    this.runner = runner;
    this.snapshots = snapshots;
    this.boards = boards;
    this.context = context;
  }

  boolean watching(UUID player) {
    return watching.contains(player);
  }

  int count() {
    return watching.size();
  }

  /** {@code /rwf spectate}: start watching, or return why not. */
  Optional<String> watch(Player player) {
    var id = player.getUniqueId();
    if (runner.memberOf(id).isPresent()) {
      return Optional.of("You are in the match; leave it with /rwf leave before watching.");
    }
    if (watching.contains(id)) {
      unfollow(player);
      player.teleport(runner.watchPoint());
      Texts.info(player, "Back at the spectator point.");
      return Optional.empty();
    }
    var refusal = runner.snapshotRefusal(player);
    if (refusal.isPresent()) {
      return refusal;
    }
    watching.add(id);
    saving.add(id);
    snapshots.capture(player, Snapshots.WATCH_SCOPE, stored -> stored(player, stored));
    if (!watching.contains(id)) {
      // The snapshot could not even be taken; the player was told and left as they were.
      return Optional.empty();
    }
    PlayerStates.wipe(player, GameMode.SPECTATOR);
    player.teleport(runner.watchPoint());
    boards.show(player);
    Texts.info(
        player,
        "You are watching Search and Destroy. /rwf spectate next follows the next fighter;"
            + " /rwf leave takes you back.");
    return Optional.empty();
  }

  private void stored(Player player, boolean stored) {
    var id = player.getUniqueId();
    saving.remove(id);
    if (stored || !watching.remove(id)) {
      return;
    }
    // The keeper has already put the player back from memory.
    boards.hide(player);
    Texts.error(player, "Your belongings could not be saved, so you cannot watch.");
  }

  /** {@code /rwf join} from a watcher: they become a member under the snapshot they hold. */
  Optional<String> join(Player player) {
    var id = player.getUniqueId();
    if (saving.contains(id)) {
      return Optional.of("Your belongings are still being saved; try again in a moment.");
    }
    var target = player.getSpectatorTarget();
    unfollow(player);
    var refusal = runner.admitWatcher(player);
    if (runner.memberOf(id).isPresent()) {
      watching.remove(id);
    } else if (target != null) {
      follow(player, target);
    }
    return refusal;
  }

  /** {@code /rwf leave} from a watcher: false if {@code player} is not watching. */
  boolean leave(Player player) {
    if (!watching.contains(player.getUniqueId())) {
      return false;
    }
    restore(player);
    return true;
  }

  /** The watcher quit: they are restored before the server saves them. */
  void quit(Player player) {
    if (watching.contains(player.getUniqueId())) {
      restore(player);
    }
  }

  /** The module is stopping: every watcher still online goes back. */
  void stop() {
    for (var id : List.copyOf(watching)) {
      var player = context.server().getPlayer(id);
      if (player == null) {
        watching.remove(id);
      } else {
        restore(player);
      }
    }
  }

  private void restore(Player player) {
    var id = player.getUniqueId();
    watching.remove(id);
    unfollow(player);
    boards.hide(player);
    if (snapshots.restore(player) == SnapshotKeeper.Outcome.NOTHING) {
      throw new IllegalStateException(player.getName() + " was watching without a snapshot");
    }
  }

  /** {@code /rwf spectate next}: follow the next fighter after the one followed now. */
  Optional<String> next(Player player) {
    if (!watching.contains(player.getUniqueId())) {
      return Optional.of("You are not watching; start with /rwf spectate.");
    }
    var fighters = runner.followable();
    if (fighters.isEmpty()) {
      return Optional.of("Nobody is in the match to follow.");
    }
    var following = player.getSpectatorTarget();
    var index = -1;
    for (var i = 0; following != null && i < fighters.size(); i++) {
      if (fighters.get(i).getUniqueId().equals(following.getUniqueId())) {
        index = i;
      }
    }
    var next = fighters.get((index + 1) % fighters.size());
    player.teleport(Places.at(next));
    follow(player, next);
    Texts.info(player, "Following " + next.getName() + ".");
    return Optional.empty();
  }

  /** A new map was chosen: every watcher moves to its spectator point. */
  void onTransition(MatchNotification notification) {
    if (!(notification.event() instanceof MatchEvent.MapChosen)) {
      return;
    }
    for (var id : watching) {
      var player = context.server().getPlayer(id);
      if (player != null) {
        unfollow(player);
        player.teleport(runner.watchPoint());
      }
    }
  }

  /** The server only lets a player in spectator mode follow (or stop following) anyone. */
  private static void follow(Player player, Entity target) {
    if (player.getGameMode() == GameMode.SPECTATOR) {
      player.setSpectatorTarget(target);
    }
  }

  private static void unfollow(Player player) {
    if (player.getGameMode() == GameMode.SPECTATOR) {
      player.setSpectatorTarget(null);
    }
  }
}
