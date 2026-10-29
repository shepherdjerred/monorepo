package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/**
 * The player bodies bots inhabit, and the handful of things a body can be told to do. The Citizens
 * adapter is the production implementation; tests use MockBukkit players. Entities are resolved on
 * every call and never cached by callers, because Citizens replaces the entity when a skin lands.
 * Main thread only.
 */
public interface Bodies {

  /**
   * Creates an unspawned body for {@code personality} and returns the UUID its entity will have.
   */
  UUID create(Personality personality);

  /** Puts the body into the world at {@code at}. */
  void spawn(UUID bot, Location at);

  /** Moves a spawned body, preserving its state; the returned entity may be a replacement. */
  Player move(UUID bot, Location to);

  /** Removes the body from the world and forgets it; {@link #isBot} stays true for its UUID. */
  void despawn(UUID bot);

  /** The player entity, while spawned. */
  Optional<Player> entity(UUID bot);

  /** Whether {@code entity} is, or was, one of these bodies. */
  boolean isBot(UUID entity);

  /** Every body created and not yet despawned. */
  Set<UUID> living();

  /** Despawns every body. */
  void despawnAll();

  /** Walks or sprints towards {@code target} this tick. */
  void moveToward(UUID bot, Location target, boolean sprint);

  /** Final motion intent; authored traversal is explicit and bounded by the active arena. */
  record MotionTarget(
      Location at,
      boolean sprint,
      Hop hop,
      Optional<GridBounds> bounds,
      Optional<JumpLaunch> runUp) {
    public MotionTarget(Location at, boolean sprint, Hop hop, Optional<GridBounds> bounds) {
      this(at, sprint, hop, bounds, Optional.empty());
    }
  }

  /**
   * Production bodies re-read terrain here; fake bodies can keep deterministic synthetic motion.
   */
  default MovementSafety.Reason moveSafely(UUID bot, MotionTarget target) {
    moveToward(bot, target.at(), target.sprint());
    return MovementSafety.Reason.CLEAR;
  }

  /** Why the body last refused a step, when production movement recorded one. */
  default Optional<String> lastRefusal(UUID bot) {
    return Optional.empty();
  }

  void stop(UUID bot);

  void look(UUID bot, float yaw, float pitch);

  /** Jumps if standing on something. */
  void jump(UUID bot);

  /**
   * Sprint-jumps along the heading it steered this tick if standing on something, with the inputs a
   * player holds through the flight ({@link
   * com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor#hop}).
   */
  void hop(UUID bot);

  void sneak(UUID bot, boolean sneaking);

  void selectSlot(UUID bot, int slot);

  void swing(UUID bot);

  /** Starts holding right click on the held item: draws a bow, starts eating. */
  void startUsing(UUID bot);

  /** Lets go of right click; {@code complete} finishes the use (eats the apple) instead. */
  void stopUsing(UUID bot, boolean complete);

  /** What the body is holding right click on, if anything. */
  Optional<ActiveItem> activeItem(UUID bot);

  /**
   * An item being used.
   *
   * @param type what
   * @param usedTicks how long it has been held
   */
  record ActiveItem(Material type, int usedTicks) {}
}
