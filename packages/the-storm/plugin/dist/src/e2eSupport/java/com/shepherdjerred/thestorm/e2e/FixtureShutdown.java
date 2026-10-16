package com.shepherdjerred.thestorm.e2e;

import static java.util.Objects.requireNonNull;

/** One cleanup attempt while the product plugin's shared classes are still available. */
final class FixtureShutdown implements AutoCloseable {
  private final Runnable cleanup;
  private boolean attempted;

  FixtureShutdown(Runnable cleanup) {
    this.cleanup = requireNonNull(cleanup);
  }

  void pluginDisabling(String pluginName) {
    if ("TheStorm".equals(pluginName)) close();
  }

  @Override
  public void close() {
    if (attempted) return;
    attempted = true;
    cleanup.run();
  }
}
