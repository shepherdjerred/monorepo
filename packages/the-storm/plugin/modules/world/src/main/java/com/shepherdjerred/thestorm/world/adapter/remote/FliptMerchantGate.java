package com.shepherdjerred.thestorm.world.adapter.remote;

import com.shepherdjerred.thestorm.world.app.MerchantGate;
import java.net.URI;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Evaluates the independently managed merchant flag through the shared Flipt client. */
public final class FliptMerchantGate implements MerchantGate, AutoCloseable {

  private static final String FLAG_KEY = "the-storm-merchant-enabled";

  private final FliptCrierGate client;

  public FliptMerchantGate(URI base, String environment) {
    client = new FliptCrierGate(base, environment, FLAG_KEY);
  }

  @Override
  public CompletableFuture<Boolean> enabled(UUID player) {
    return client.enabled(player);
  }

  @Override
  public void close() {
    client.close();
  }
}
