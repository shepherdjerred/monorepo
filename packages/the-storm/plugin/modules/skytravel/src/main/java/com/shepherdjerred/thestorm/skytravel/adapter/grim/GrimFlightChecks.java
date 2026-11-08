package com.shepherdjerred.thestorm.skytravel.adapter.grim;

import ac.grim.grimac.api.AbstractCheck;
import ac.grim.grimac.api.GrimAPIProvider;
import ac.grim.grimac.api.GrimUser;
import com.shepherdjerred.thestorm.skytravel.app.FlightChecks;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/** Pauses only movement prediction checks; restores exactly those enabled when the flight began. */
public final class GrimFlightChecks implements FlightChecks {
  private static final Set<String> MOVEMENT =
      Set.of(
          "Simulation",
          "GroundSpoof",
          "Phase",
          "grim.prediction.simulation",
          "grim.prediction.phase");

  private record Held(GrimUser user, List<AbstractCheck> checks) {}

  private final Map<UUID, Held> held = new ConcurrentHashMap<>();
  private final Map<UUID, Long> requested = new ConcurrentHashMap<>();
  private final AtomicLong serial = new AtomicLong();
  private final Function<UUID, @Nullable GrimUser> users;

  public GrimFlightChecks() {
    this(id -> GrimAPIProvider.get().getGrimUser(id));
  }

  GrimFlightChecks(Function<UUID, @Nullable GrimUser> users) {
    this.users = users;
  }

  @Override
  public void active(UUID player, boolean active) {
    if (active) {
      var token = serial.incrementAndGet();
      if (requested.putIfAbsent(player, token) != null) return;
      var user = users.apply(player);
      if (user == null) {
        requested.remove(player);
        throw new IllegalStateException("Grim has not registered the launching player");
      }
      user.runSafely(() -> pause(player, user, token));
    } else {
      requested.remove(player);
      var saved = held.remove(player);
      if (saved != null) saved.user().runSafely(() -> restore(saved));
    }
  }

  private void pause(UUID player, GrimUser user, long token) {
    if (!Long.valueOf(token).equals(requested.get(player))) return;
    var checks = new ArrayList<AbstractCheck>();
    for (var check : user.getChecks()) {
      var key = check.getStableKey();
      if (check.isEnabled()
          && (MOVEMENT.contains(check.getCheckName()) || (key != null && MOVEMENT.contains(key)))) {
        check.setEnabled(false);
        checks.add(check);
      }
    }
    var saved = new Held(user, List.copyOf(checks));
    held.put(player, saved);
    if (!Long.valueOf(token).equals(requested.get(player)) && held.remove(player, saved))
      restore(saved);
  }

  private static void restore(Held saved) {
    for (var check : saved.checks()) check.setEnabled(true);
  }

  @Override
  public void stop() {
    for (var player : Set.copyOf(requested.keySet())) active(player, false);
  }
}
