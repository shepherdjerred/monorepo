package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import java.util.ArrayList;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;

/** The memberships, routers, taps and prefix provider other modules registered. Thread-safe. */
public final class ChatExtensions implements ChannelRegistry, PrefixRegistry {

  private final Map<ChannelKey, ChannelMembership> memberships = new ConcurrentHashMap<>();
  private final CopyOnWriteArrayList<ChannelRouter> routers = new CopyOnWriteArrayList<>();
  private final CopyOnWriteArrayList<ChatTap> taps = new CopyOnWriteArrayList<>();
  private final AtomicReference<PrefixProvider> prefixes =
      new AtomicReference<>(PrefixProvider.NONE);

  @Override
  public Subscription registerMembership(ChatChannel channel, ChannelMembership membership) {
    var key = channel.key();
    if (key.reach() != ChannelKey.Reach.MEMBERS) {
      throw new IllegalArgumentException(channel + " is not a membership channel");
    }
    if (memberships.putIfAbsent(key, membership) != null) {
      throw new IllegalStateException(key.id() + " chat membership is already registered");
    }
    return () -> memberships.remove(key, membership);
  }

  @Override
  public Subscription registerRouter(ChannelRouter router) {
    var registered = new Registered<>(router);
    routers.add(router);
    return () -> registered.remove(routers);
  }

  @Override
  public Subscription registerTap(ChatTap tap) {
    var registered = new Registered<>(tap);
    taps.add(tap);
    return () -> registered.remove(taps);
  }

  @Override
  public void registerPrefixProvider(PrefixProvider provider) {
    if (!prefixes.compareAndSet(PrefixProvider.NONE, provider)) {
      throw new IllegalStateException("a chat prefix provider is already registered");
    }
  }

  /** {@code channel}'s membership, if a module registered it. */
  public Optional<ChannelMembership> membership(ChannelKey channel) {
    return Optional.ofNullable(memberships.get(channel));
  }

  /** Town membership, if the towns module registered it. */
  public Optional<ChannelMembership> townMembership() {
    return membership(ChannelKey.TOWN);
  }

  /** The first router's answer for {@code request}, if any router redirects it. */
  public Optional<ChannelRouter.Routed> route(ChannelRouter.Request request) {
    for (var router : routers) {
      var routed = router.route(request);
      if (routed.isPresent()) {
        return routed;
      }
    }
    return Optional.empty();
  }

  /**
   * Tells every tap about {@code line}. A tap that throws does not stop the others; the first
   * failure is rethrown, with the rest suppressed in it, once all of them have heard the line.
   */
  public void heard(ChatTap.Heard line) {
    var failures = new ArrayList<RuntimeException>();
    for (var tap : taps) {
      try {
        tap.heard(line);
      } catch (RuntimeException e) {
        failures.add(e);
      }
    }
    if (!failures.isEmpty()) {
      var first = failures.getFirst();
      failures.subList(1, failures.size()).forEach(first::addSuppressed);
      throw first;
    }
  }

  /** {@code player}'s prefix; empty until a provider is registered. */
  public String prefix(UUID player) {
    return prefixes.get().prefix(player);
  }

  /**
   * One registration, removed by identity: the same router or tap registered twice is two
   * registrations, and cancelling one leaves the other.
   */
  private static final class Registered<T> {

    private final T value;
    private boolean removed;

    Registered(T value) {
      this.value = value;
    }

    synchronized void remove(CopyOnWriteArrayList<T> from) {
      if (!removed) {
        removed = true;
        from.remove(value);
      }
    }
  }
}
