package com.shepherdjerred.thestorm.towns.adapter.remote;

import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import com.shepherdjerred.thestorm.towns.app.RentalGate;
import java.net.URI;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Per-admission boolean evaluation using the same Flags bootstrap as the world module. */
public final class FliptRentalGate implements RentalGate, AutoCloseable {
  public static final String FLAG_KEY = "the-storm-shop-rentals-enabled";
  private final FlagsClient client;

  public FliptRentalGate(URI base, String deployment) {
    this.client = new FlagsClient(base, deployment);
  }

  @Override
  public CompletableFuture<Boolean> enabled(UUID player) {
    return client.evaluate(FLAG_KEY, Map.of("user", player.toString(), "world", "world"));
  }

  @Override
  public void close() {
    client.close();
  }
}
