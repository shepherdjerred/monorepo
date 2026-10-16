package com.shepherdjerred.thestorm.safety.app;

/** Repository-owned bootstrap; rollout policy is evaluated through ManagedGameplay. */
public record SafetyConfig(
    String brainUrl,
    String tokenEnvironment,
    int requestTimeoutMillis,
    int publicationTimeoutSeconds,
    int maxPendingPerPlayer) {
  public SafetyConfig {
    if (!brainUrl.startsWith("http://") && !brainUrl.startsWith("https://"))
      throw new IllegalArgumentException("Safety brain URL must be HTTP(S)");
    if (tokenEnvironment.isBlank()
        || requestTimeoutMillis < 1000
        || requestTimeoutMillis > 10000
        || publicationTimeoutSeconds < 1
        || publicationTimeoutSeconds > 30
        || maxPendingPerPlayer < 1
        || maxPendingPerPlayer > 64) throw new IllegalArgumentException("Invalid safety bounds");
  }
}
