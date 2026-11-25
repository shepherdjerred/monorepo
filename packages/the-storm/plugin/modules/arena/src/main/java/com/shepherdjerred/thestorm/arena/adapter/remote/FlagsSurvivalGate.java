package com.shepherdjerred.thestorm.arena.adapter.remote;

import com.shepherdjerred.thestorm.arena.app.SurvivalGate;
import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import java.net.URI;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Evaluates the managed survival flag without blocking Paper's main thread. */
public final class FlagsSurvivalGate implements SurvivalGate, AutoCloseable {

  private static final String FLAG_KEY = "the-storm-survival-enabled";
  private final FlagsClient client;
  private final String flagKey;

  public FlagsSurvivalGate(URI base) {
    this(base, "minecraft/tsmc");
  }

  public FlagsSurvivalGate(URI base, String deployment) {
    this(base, deployment, FLAG_KEY);
  }

  FlagsSurvivalGate(URI base, String deployment, String flagKey) {
    this.client = new FlagsClient(base, deployment);
    this.flagKey = flagKey;
  }

  @Override
  public CompletableFuture<Boolean> enabled(UUID player) {
    return client.evaluate(flagKey, Map.of("user", player.toString(), "world", "world"));
  }

  @Override
  public void close() {
    client.close();
  }
}
