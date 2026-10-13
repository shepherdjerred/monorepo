package com.shepherdjerred.thestorm.core.compute;

/** Repository-owned compute.yml, read once at startup; a CPU remains reserved for Paper. */
public record ComputeSettings(int maxThreads) {
  public static final int MAX_THREADS = 10;

  public ComputeSettings {
    if (maxThreads < 1 || maxThreads > MAX_THREADS)
      throw new IllegalArgumentException("compute maxThreads must be between 1 and " + MAX_THREADS);
  }
}
