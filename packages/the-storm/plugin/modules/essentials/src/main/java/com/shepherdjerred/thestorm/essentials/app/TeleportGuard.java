package com.shepherdjerred.thestorm.essentials.app;

import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;

/**
 * A rule another module adds to stop teleports, such as "not while in combat" from qol. Called on
 * the main thread, so it must be fast and must not block.
 */
@FunctionalInterface
public interface TeleportGuard {

  /** Why {@code mover} may not teleport to {@code destination} right now, or empty to allow it. */
  Optional<Component> refusal(UUID mover, Location destination);
}
