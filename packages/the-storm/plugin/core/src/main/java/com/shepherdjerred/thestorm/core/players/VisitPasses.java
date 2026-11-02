package com.shepherdjerred.thestorm.core.players;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** The in-memory {@link VisitPass}. A pass is one teleport, visible across Paper's move thread. */
public final class VisitPasses implements VisitPass {

  private final Set<UUID> armed = ConcurrentHashMap.newKeySet();

  @Override
  public void allowNextPluginTeleport(UUID player) {
    armed.add(player);
  }

  @Override
  public boolean consumePluginTeleport(UUID player) {
    return armed.remove(player);
  }
}
