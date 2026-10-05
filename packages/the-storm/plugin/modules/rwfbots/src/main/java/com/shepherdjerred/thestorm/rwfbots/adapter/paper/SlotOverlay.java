package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.rwfbots.app.DecisionBoard;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.time.Duration;
import java.util.HashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.Color;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * Draws every bot's playbook slot and current route with dust particles that only one viewer sees,
 * for {@link #SHOWS} redraws half a second apart: a ring at each slot, a trail along each route,
 * coloured by team. Main thread only; it reads the newest decision board each redraw.
 */
final class SlotOverlay {

  /** How many times the overlay is redrawn. */
  static final int SHOWS = 20;

  static final Duration EVERY = Duration.ofMillis(500);

  private static final int RING_POINTS = 12;
  private static final double RING_RADIUS = 0.8;
  private static final float SLOT_SIZE = 1.6f;
  private static final float ROUTE_SIZE = 0.8f;

  private final ThinkLoop loop;
  private final Scheduler scheduler;
  private final World world;

  SlotOverlay(ThinkLoop loop, Scheduler scheduler, World world) {
    this.loop = loop;
    this.scheduler = scheduler;
    this.world = world;
  }

  /** Starts drawing for {@code viewer}; it stops by itself after {@link #SHOWS} redraws. */
  void show(Player viewer) {
    var left = new AtomicInteger(SHOWS);
    var task = new AtomicReference<@Nullable Cancellable>();
    task.set(
        scheduler.repeatOnMainThread(
            Duration.ZERO,
            EVERY,
            () -> {
              if (left.getAndDecrement() <= 0 || !viewer.isOnline()) {
                var running = task.get();
                if (running != null) {
                  running.cancel();
                }
                return;
              }
              draw(viewer, loop.board());
            }));
  }

  private void draw(Player viewer, DecisionBoard board) {
    if (!viewer.getWorld().equals(world)) {
      return;
    }
    var teamOf = new HashMap<CombatantId, TeamId>();
    board
        .plans()
        .forEach(
            (team, plan) -> {
              plan.assignment().keySet().forEach(bot -> teamOf.put(bot, team));
              for (var slot : plan.slots()) {
                ring(viewer, slot, colour(team));
              }
            });
    board
        .thoughts()
        .forEach(
            (bot, thought) -> {
              var team = teamOf.get(bot);
              var colour = team == null ? Color.WHITE : colour(team);
              for (var waypoint : thought.decision().waypoints()) {
                dust(viewer, waypoint.pos().plus(0, 0.2, 0), colour, ROUTE_SIZE);
              }
            });
  }

  private static void ring(Player viewer, Slot slot, Color colour) {
    for (var i = 0; i < RING_POINTS; i++) {
      var angle = 2 * Math.PI * i / RING_POINTS;
      dust(
          viewer,
          slot.pos().plus(Math.cos(angle) * RING_RADIUS, 0.3, Math.sin(angle) * RING_RADIUS),
          colour,
          SLOT_SIZE);
    }
  }

  private static void dust(Player viewer, Vec3 at, Color colour, float size) {
    viewer.spawnParticle(
        Particle.DUST,
        at.x(),
        at.y(),
        at.z(),
        1,
        0,
        0,
        0,
        0,
        new Particle.DustOptions(colour, size));
  }

  static Color colour(TeamId team) {
    return switch (team.value()) {
      case "red" -> Color.RED;
      case "blue" -> Color.BLUE;
      default -> Color.WHITE;
    };
  }
}
