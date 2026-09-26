package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.qol.domain.sleep.SleepVote;
import java.util.List;
import org.bukkit.GameMode;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerBedEnterEvent;

/**
 * The sleep vote: when enough of a world's present players are asleep, the night (or storm) passes.
 * Players marked AFK are left out unless they are in bed.
 */
final class SleepListener implements Listener {

  private final QolRuntime runtime;
  private final SleepVote vote;
  private final AfkStatus afk;
  private final String morningMessage;

  SleepListener(QolRuntime runtime, SleepVote vote, AfkStatus afk, String morningMessage) {
    this.runtime = runtime;
    this.vote = vote;
    this.afk = afk;
    this.morningMessage = morningMessage;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onBed(PlayerBedEnterEvent event) {
    var sleeper = event.getPlayer();
    // The player is in bed from the next tick, if the bed let them in at all.
    runtime
        .scheduler()
        .runOnMainThread(
            () -> {
              if (!sleeper.isOnline() || !sleeper.isSleeping()) {
                return;
              }
              var world = sleeper.getWorld();
              var tally = vote.tally(sleepers(world));
              for (var player : world.getPlayers()) {
                Say.info(
                    player,
                    Say.SLEEP,
                    sleeper.getName()
                        + " is sleeping ("
                        + tally.sleeping()
                        + "/"
                        + tally.needed()
                        + " needed to skip the night).");
              }
            });
  }

  /** Every second: skips the night in any world where enough players are fast asleep. */
  void tick() {
    for (var world : runtime.server().getWorlds()) {
      var players = world.getPlayers();
      if (players.stream().noneMatch(Player::isSleeping)) {
        continue;
      }
      if (vote.tally(sleepers(world)).skips()) {
        world.setFullTime(SleepVote.nextMorning(world.getFullTime()));
        world.setStorm(false);
        world.setThundering(false);
        for (var player : players) {
          Say.success(player, Say.SLEEP, morningMessage);
        }
      }
    }
  }

  private List<SleepVote.Sleeper> sleepers(World world) {
    return world.getPlayers().stream()
        .map(
            player ->
                new SleepVote.Sleeper(
                    player.isSleeping(),
                    player.isDeeplySleeping(),
                    afk.isAfk(player.getUniqueId()),
                    player.getGameMode() == GameMode.SPECTATOR || player.isSleepingIgnored()))
        .toList();
  }
}
