package com.shepherdjerred.thestorm.core.players;

import java.util.UUID;

/**
 * One accepted {@code /tpa} or {@code /tpahere} landing. Essentials arms it immediately before the
 * move; towns consumes it for that plugin teleport and skips land entry. Anything else, including
 * the next teleport, is unchanged.
 */
public interface VisitPass {

  /** The next plugin or command teleport of {@code player} may enter claimed land. */
  void allowNextPluginTeleport(UUID player);

  /**
   * True when {@code player} had a pass, which this call spends. Ender pearls, chorus fruit and
   * portals must not call this.
   */
  boolean consumePluginTeleport(UUID player);
}
