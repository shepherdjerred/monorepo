package com.shepherdjerred.thestorm.chat.app;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.jspecify.annotations.Nullable;

/** The town membership and prefix provider other modules registered. Thread-safe. */
public final class ChatExtensions implements ChannelRegistry, PrefixRegistry {

  private final AtomicReference<@Nullable ChannelMembership> town = new AtomicReference<>();
  private final AtomicReference<PrefixProvider> prefixes =
      new AtomicReference<>(PrefixProvider.NONE);

  @Override
  public void registerTownMembership(ChannelMembership membership) {
    if (!town.compareAndSet(null, membership)) {
      throw new IllegalStateException("town chat membership is already registered");
    }
  }

  @Override
  public void registerPrefixProvider(PrefixProvider provider) {
    if (!prefixes.compareAndSet(PrefixProvider.NONE, provider)) {
      throw new IllegalStateException("a chat prefix provider is already registered");
    }
  }

  /** Town membership, if the towns module registered it. */
  public Optional<ChannelMembership> townMembership() {
    return Optional.ofNullable(town.get());
  }

  /** {@code player}'s prefix; empty until a provider is registered. */
  public String prefix(UUID player) {
    return prefixes.get().prefix(player);
  }
}
