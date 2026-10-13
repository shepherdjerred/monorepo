// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/WinManager.java#onHalfSecond,
// GameManager.java#onGameEnd and game/Game.java#spawnFireworks); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.List;
import java.util.random.RandomGenerator;
import org.bukkit.Color;
import org.bukkit.FireworkEffect;
import org.bukkit.Location;
import org.bukkit.entity.Firework;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

/**
 * Red Warfare's end of a match: everyone still fighting takes off and flies, and every half second
 * a firework in the winners' colour goes off near a random winner, plus one at each winner who
 * crouches (at most ten). Main thread.
 */
final class Celebration {

  /** How far from a winner the half-second firework lands, either way on each axis. */
  static final double SPREAD = 15;

  /** The most crouching winners a half second gives a firework. */
  static final int CROUCHING_FIREWORKS = 10;

  private static final FireworkEffect.Type[] TYPES = FireworkEffect.Type.values();

  private Celebration() {}

  /** GameManager#onGameEnd: the players still in the fight fly, nudged off the ground. */
  static void takeOff(List<Player> fighters) {
    for (var player : fighters) {
      player.setAllowFlight(true);
      player.setFlying(true);
      player.setVelocity(new Vector(0, 0.1, 0));
    }
  }

  /** One half second of the end screen's fireworks over {@code winners}. */
  static void halfSecond(List<Player> winners, Color color, RandomGenerator random) {
    if (winners.isEmpty()) {
      return;
    }
    var winner = winners.get(random.nextInt(winners.size()));
    var near =
        Places.at(winner)
            .add(random.nextDouble(-SPREAD, SPREAD), 0, random.nextDouble(-SPREAD, SPREAD));
    launch(
        near,
        color,
        random,
        new Vector(
            random.nextDouble(-0.05, 0.05),
            -random.nextDouble(0.1),
            random.nextDouble(-0.05, 0.05)));
    var crouching = 0;
    for (var player : winners) {
      if (player.isSneaking() && crouching++ < CROUCHING_FIREWORKS) {
        launch(
            Places.at(player),
            color,
            random,
            new Vector(random.nextDouble(-0.2, 0.2), 0, random.nextDouble(-0.2, 0.2)));
      }
    }
  }

  /** UtilFirework#spawnRandomFirework: a random shape in {@code color}, sent along {@code push}. */
  private static void launch(Location at, Color color, RandomGenerator random, Vector push) {
    var world = at.getWorld();
    if (world == null) {
      return;
    }
    var effect =
        FireworkEffect.builder()
            .with(TYPES[random.nextInt(TYPES.length)])
            .withColor(color)
            .flicker(random.nextBoolean())
            .trail(random.nextBoolean())
            .build();
    world.spawn(
        at,
        Firework.class,
        firework -> {
          var meta = firework.getFireworkMeta();
          meta.addEffect(effect);
          meta.setPower(random.nextInt(2));
          firework.setFireworkMeta(meta);
          firework.setVelocity(push);
        });
  }
}
