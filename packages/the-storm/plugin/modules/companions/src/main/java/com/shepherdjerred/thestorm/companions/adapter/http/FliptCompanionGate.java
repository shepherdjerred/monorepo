package com.shepherdjerred.thestorm.companions.adapter.http;

import com.shepherdjerred.thestorm.companions.app.CompanionGate;
import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/** Fail-closed, asynchronous flag evaluation. */
public final class FliptCompanionGate implements CompanionGate {
  private static final String FLAG_KEY = "the-storm-companions-enabled";
  private final FlagsClient client;

  public FliptCompanionGate(URI base, String deployment) {
    this.client = new FlagsClient(base, deployment);
  }

  @Override
  public CompletableFuture<Boolean> enabled() {
    return client.evaluate(FLAG_KEY, Map.of());
  }

  @Override
  public void close() {
    client.close();
  }
}
