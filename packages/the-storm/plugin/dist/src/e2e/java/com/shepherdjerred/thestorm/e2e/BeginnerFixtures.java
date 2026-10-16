package com.shepherdjerred.thestorm.e2e;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.mobs.app.MobLevels;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.Map;
import org.bukkit.Difficulty;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.Player;
import org.bukkit.entity.Zombie;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.plugin.java.JavaPlugin;
import tools.jackson.databind.json.JsonMapper;

/** Native damage and shared-level probes, only in the disposable offline fixtures jar. */
final class BeginnerFixtures implements BasicCommand {
  private final JavaPlugin plugin;

  BeginnerFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-beginners", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender)
        && !(source.getSender() instanceof RemoteConsoleCommandSender)) {
      throw new IllegalArgumentException("beginner fixture requires the disposable console");
    }
    if (args.length != 2)
      throw new IllegalArgumentException("expected beginner and control player names");
    var player = requireNonNull(plugin.getServer().getPlayerExact(args[0]));
    var control = requireNonNull(plugin.getServer().getPlayerExact(args[1]));
    if (!player.getWorld().getName().equals("wilds"))
      throw new IllegalArgumentException("probe requires wilds");
    if (!control.getWorld().equals(player.getWorld())
        || control.getLocation().distanceSquared(player.getLocation()) > 100)
      throw new IllegalArgumentException("control player must be nearby in wilds");
    var storm =
        (TheStormPlugin)
            requireNonNull(plugin.getServer().getPluginManager().getPlugin("TheStorm"));
    var levels = storm.service(MobLevels.class);
    var originalDifficulty = player.getWorld().getDifficulty();
    player.getWorld().setDifficulty(Difficulty.HARD);
    try {
      probe(source, player, control, levels);
    } finally {
      player.getWorld().setDifficulty(originalDifficulty);
    }
  }

  private static void probe(
      CommandSourceStack source, Player player, Player control, MobLevels levels) {
    var at = requireNonNull(player.getLocation());
    var zombie = at.getWorld().spawn(at.clone().add(2, 0, 0), Zombie.class, SpawnReason.NATURAL);
    zombie.setAI(false);
    zombie.setSilent(true);
    var creeper = at.getWorld().spawn(at.clone().add(3, 0, 0), Creeper.class, SpawnReason.NATURAL);
    creeper.setAI(false);
    var arrow = at.getWorld().spawn(at.clone().add(0, 2, 0), Arrow.class);
    arrow.setShooter(zombie);
    try {
      var projectile =
          DamageSource.builder(DamageType.ARROW)
              .withCausingEntity(zombie)
              .withDirectEntity(arrow)
              .build();
      var explosion =
          DamageSource.builder(DamageType.EXPLOSION)
              .withCausingEntity(creeper)
              .withDirectEntity(creeper)
              .build();
      var melee = damage(player, () -> zombie.attack(player));
      var normalMelee = damage(control, () -> zombie.attack(control));
      var ranged = damage(player, () -> player.damage(10, projectile));
      var normalRanged = damage(control, () -> control.damage(10, projectile));
      var blast = damage(player, () -> player.damage(10, explosion));
      var normalBlast = damage(control, () -> control.damage(10, explosion));
      var result =
          Map.of(
              "zombieLevel",
              levels.levelOf(zombie).orElseThrow(),
              "creeperLevel",
              levels.levelOf(creeper).orElseThrow(),
              "melee",
              melee,
              "ranged",
              ranged,
              "blast",
              blast,
              "normalMelee",
              normalMelee,
              "normalRanged",
              normalRanged,
              "normalBlast",
              normalBlast);
      source.getSender().sendMessage(JsonMapper.builder().build().writeValueAsString(result));
    } finally {
      zombie.remove();
      creeper.remove();
      arrow.remove();
      player.setHealth(20);
      control.setHealth(20);
    }
  }

  private static double damage(Player player, Runnable attack) {
    player.getInventory().clear();
    player.setHealth(20);
    player.setAbsorptionAmount(0);
    player.setNoDamageTicks(0);
    attack.run();
    return 20 - player.getHealth();
  }
}
