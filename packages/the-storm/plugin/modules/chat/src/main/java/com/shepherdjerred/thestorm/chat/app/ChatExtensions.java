package com.shepherdjerred.thestorm.chat.app;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/** The membership resolvers and prefix provider other modules registered. Thread-safe. */
public final class ChatExtensions implements ChannelRegistry, PrefixRegistry {

  private final Map<GroupChannel, ChannelMembership> memberships = new ConcurrentHashMap<>();
  private final AtomicReference<PrefixProvider> prefixes =
      new AtomicReference<>(PrefixProvider.NONE);

  @Override
  public void registerMembership(GroupChannel channel, ChannelMembership membership) {
    var previous = memberships.putIfAbsent(channel, membership);
    if (previous != null) {
      throw new IllegalStateException(channel + " chat membership is already registered");
    }
  }

  @Override
  public void registerPrefixProvider(PrefixProvider provider) {
    if (!prefixes.compareAndSet(PrefixProvider.NONE, provider)) {
      throw new IllegalStateException("a chat prefix provider is already registered");
    }
  }

  /** The membership of {@code channel}, if a module registered one. */
  public Optional<ChannelMembership> membership(GroupChannel channel) {
    return Optional.ofNullable(memberships.get(channel));
  }

  /** {@code player}'s prefix; empty until a provider is registered. */
  public String prefix(UUID player) {
    return prefixes.get().prefix(player);
  }
}
