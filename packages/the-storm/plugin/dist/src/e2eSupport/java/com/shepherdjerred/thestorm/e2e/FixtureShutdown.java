package com.shepherdjerred.thestorm.e2e;

import static java.util.Objects.requireNonNull;

import java.util.List;

/** One cleanup attempt while the product plugin's shared classes are still available. */
final class FixtureShutdown implements AutoCloseable {
  private final List<Runnable> cleanups;
  private boolean attempted;

  FixtureShutdown(Runnable... cleanups) {
    this.cleanups = List.of(requireNonNull(cleanups));
  }

  void pluginDisabling(String pluginName) {
    if ("TheStorm".equals(pluginName)) close();
  }

  @Override
  public void close() {
    if (attempted) return;
    attempted = true;
    Throwable first = null;
    for (var cleanup : cleanups) {
      try {
        cleanup.run();
      } catch (RuntimeException | Error failure) {
        if (first == null) first = failure;
        else if (!first.equals(failure)) first.addSuppressed(failure);
      }
    }
    if (first instanceof RuntimeException failure) throw failure;
    if (first instanceof Error failure) throw failure;
  }
}
