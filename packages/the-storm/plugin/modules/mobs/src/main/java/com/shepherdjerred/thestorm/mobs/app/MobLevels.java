package com.shepherdjerred.thestorm.mobs.app;

import java.util.OptionalInt;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;

/**
 * Levelled mobs, published by the mobs module. Main thread only.
 *
 * <p>Mobs that must never be levelled should carry the persistent-data key {@code thestorm:arena}
 * (any type) before they are added to the world, for example from the consumer of {@code
 * World#spawn}; the arena does this for its waves. A mob that was levelled anyway can be put back
 * to vanilla with {@link #strip}.
 */
public interface MobLevels {

  /** {@code entity}'s level, or empty when it is not a levelled mob. */
  OptionalInt levelOf(Entity entity);

  /**
   * Removes {@code mob}'s level: its stat modifiers, its level tag and the nameplate the mobs
   * module gave it. Does nothing to a mob without a level.
   */
  void strip(LivingEntity mob);
}
