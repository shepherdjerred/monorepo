package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import java.util.Comparator;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Native player contact fixtures; never change immunity, equipment, health or bot decisions. */
final class RegressionPlayers {
  record PlayerProbe(
      long sequence,
      int serverTick,
      UUID match,
      UUID player,
      UUID bot,
      String gameMode,
      boolean invulnerable,
      boolean playerAlive,
      boolean botAlive,
      String botKit,
      double health,
      double absorption,
      double playerX,
      double playerY,
      double playerZ,
      double botX,
      double botY,
      double botZ,
      double botYaw) {}

  private final JavaPlugin plugin;

  RegressionPlayers(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void requireOnlinePlayer(UUID id) {
    if (plugin.getServer().getOnlinePlayers().stream().noneMatch(p -> p.getUniqueId().equals(id)))
      throw new IllegalArgumentException("regression subject needs a connected player");
  }

  PlayerProbe offer(MatchState state, UUID subject, long sequence) {
    requireOnlinePlayer(subject);
    var member = state.combatant(subject).orElseThrow();
    if (state.phase() != MatchState.Phase.LIVE || member.bot() || !member.alive())
      throw new IllegalStateException("offer requires a living player in the original match");
    var opponent =
        state.combatants().stream()
            .filter(MatchState.Fighter::bot)
            .filter(MatchState.Fighter::alive)
            .filter(fighter -> fighter.kit().filter("trooper"::equals).isPresent())
            .filter(fighter -> !fighter.team().equals(member.team()))
            .min(Comparator.comparing(MatchState.Fighter::uuid))
            .orElseThrow(
                () -> new IllegalStateException("original match has no living enemy Trooper"));
    var human = player(subject);
    var bot = player(opponent.uuid());
    var origin = bot.getLocation();
    var radians = Math.toRadians(origin.getYaw());
    var destination = origin.clone().add(-Math.sin(radians) * 1.75, 0, Math.cos(radians) * 1.75);
    if (!human.teleport(destination))
      throw new IllegalStateException("native contact teleport refused");
    var at = human.getLocation();
    return new PlayerProbe(
        sequence,
        plugin.getServer().getCurrentTick(),
        state.matchId(),
        subject,
        opponent.uuid(),
        human.getGameMode().name(),
        human.isInvulnerable(),
        member.alive(),
        opponent.alive(),
        opponent.kit().orElseThrow(),
        human.getHealth(),
        human.getAbsorptionAmount(),
        at.getX(),
        at.getY(),
        at.getZ(),
        origin.getX(),
        origin.getY(),
        origin.getZ(),
        origin.getYaw());
  }

  private Player player(UUID id) {
    var entity = plugin.getServer().getEntity(id);
    if (!(entity instanceof Player player))
      throw new IllegalStateException("native player body missing");
    return player;
  }
}
