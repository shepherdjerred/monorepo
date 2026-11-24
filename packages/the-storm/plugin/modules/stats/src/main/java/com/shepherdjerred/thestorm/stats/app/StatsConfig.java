package com.shepherdjerred.thestorm.stats.app;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Repository-owned {@code stats.yml} configuration. */
public record StatsConfig(
    String serverName,
    String publicUrl,
    String ingestUrlEnv,
    String ingestTokenEnv,
    int flushIntervalSeconds,
    int snapshotIntervalSeconds) {

  public StatsConfig {
    if (serverName.isBlank() || serverName.length() > 80) {
      throw new IllegalArgumentException("serverName must be 1..80 characters");
    }
    if (publicUrl.isBlank()
        || (!publicUrl.startsWith("https://") && !publicUrl.startsWith("http://"))) {
      throw new IllegalArgumentException("publicUrl must start with http:// or https://");
    }
    if (ingestUrlEnv.isBlank()) {
      throw new IllegalArgumentException("ingestUrlEnv must not be blank");
    }
    if (ingestTokenEnv.isBlank()) {
      throw new IllegalArgumentException("ingestTokenEnv must not be blank");
    }
    if (flushIntervalSeconds < 1 || flushIntervalSeconds > 3600) {
      throw new IllegalArgumentException("flushIntervalSeconds must be 1..3600");
    }
    if (snapshotIntervalSeconds < 1 || snapshotIntervalSeconds > 3600) {
      throw new IllegalArgumentException("snapshotIntervalSeconds must be 1..3600");
    }
  }

  /** Base public URL without trailing slash. */
  public String normalizedPublicUrl() {
    var trimmed = publicUrl.strip();
    while (trimmed.endsWith("/")) {
      trimmed = trimmed.substring(0, trimmed.length() - 1);
    }
    return trimmed;
  }

  /** Public profile URL for {@code playerName}. */
  public String playerProfileUrl(String playerName) {
    var encoded = URLEncoder.encode(playerName, StandardCharsets.UTF_8).replace("+", "%20");
    return normalizedPublicUrl() + "/player/" + encoded;
  }
}
