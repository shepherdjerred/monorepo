package com.shepherdjerred.thestorm.essentials.app;

import java.util.Optional;
import java.util.UUID;

/**
 * A rule another module adds to stop teleports, such as "not while in combat" from qol. Called on
 * the main thread, so it must be fast and must not block.
 */
@FunctionalInterface
public interface TeleportGuard {

  /** Why {@code player} may not teleport right now, or empty to allow it. */
  Optional<String> refusal(UUID player);
}
