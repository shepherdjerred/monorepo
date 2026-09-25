package com.shepherdjerred.thestorm.essentials.app;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;

/** The {@link TeleportGuards} essentials publishes, and the check it runs before teleports. */
public final class GuardRegistry implements TeleportGuards {

  private final List<TeleportGuard> guards = new CopyOnWriteArrayList<>();

  @Override
  public void add(TeleportGuard guard) {
    guards.add(guard);
  }

  /** The first refusal from any guard, or empty when every guard allows the teleport. */
  public Optional<Component> check(UUID mover, Location destination) {
    for (var guard : guards) {
      var refusal = guard.refusal(mover, destination);
      if (refusal.isPresent()) {
        return refusal;
      }
    }
    return Optional.empty();
  }
}
