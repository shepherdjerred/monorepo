package com.shepherdjerred.thestorm.core.module;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * How modules find each other. A module publishes the {@code app} ports it offers when it is
 * enabled; later modules look them up. Modules are enabled in dependency order, so a missing
 * service is a wiring bug and fails loudly.
 */
public final class Services {

  private final Map<Class<?>, Object> services = new ConcurrentHashMap<>();

  /** Publishes {@code implementation} as the one provider of {@code type}. */
  public <T> void provide(Class<T> type, T implementation) {
    var previous = services.putIfAbsent(type, implementation);
    if (previous != null) {
      throw new IllegalStateException(type.getName() + " is already provided by " + previous);
    }
  }

  /** The provider of {@code type}. */
  public <T> T require(Class<T> type) {
    var service = services.get(type);
    if (service == null) {
      throw new IllegalStateException(
          type.getName() + " is not provided; is its module enabled and ordered earlier?");
    }
    return type.cast(service);
  }

  /** Removes every provider (on plugin disable). */
  public void clear() {
    services.clear();
  }
}
