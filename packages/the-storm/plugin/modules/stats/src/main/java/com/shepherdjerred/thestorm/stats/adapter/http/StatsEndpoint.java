package com.shepherdjerred.thestorm.stats.adapter.http;

import com.shepherdjerred.thestorm.stats.app.StatsConfig;
import java.net.URI;
import java.util.Optional;
import java.util.function.Function;

/**
 * Resolves optional {@code storm-stats} ingest credentials. When both env vars are unset or blank,
 * the module runs in local-only mode; when only one is set, startup fails fast naming the missing
 * variable without ever printing secret values.
 */
public record StatsEndpoint(URI ingestUri, String bearerToken) {

  public StatsEndpoint {
    var scheme = ingestUri.getScheme();
    if ((!"https".equals(scheme) && !"http".equals(scheme))
        || ingestUri.getHost() == null
        || ingestUri.getUserInfo() != null
        || ingestUri.getFragment() != null) {
      throw new IllegalArgumentException("Invalid storm-stats ingest URI: " + ingestUri);
    }
    if (bearerToken.isBlank()) {
      throw new IllegalArgumentException("Bearer token must not be blank");
    }
  }

  public static Optional<StatsEndpoint> resolve(
      StatsConfig config, Function<String, Optional<String>> environment) {
    var rawUrl =
        environment.apply(config.ingestUrlEnv()).map(String::strip).filter(s -> !s.isEmpty());
    var token =
        environment.apply(config.ingestTokenEnv()).map(String::strip).filter(s -> !s.isEmpty());
    if (rawUrl.isEmpty() && token.isEmpty()) {
      return Optional.empty();
    }
    if (rawUrl.isEmpty()) {
      throw new IllegalStateException(
          "Stats module requires environment variable "
              + config.ingestUrlEnv()
              + " when "
              + config.ingestTokenEnv()
              + " is set");
    }
    if (token.isEmpty()) {
      throw new IllegalStateException(
          "Stats module requires environment variable "
              + config.ingestTokenEnv()
              + " when "
              + config.ingestUrlEnv()
              + " is set");
    }
    URI parsed;
    try {
      parsed = URI.create(rawUrl.orElseThrow());
    } catch (IllegalArgumentException invalid) {
      throw new IllegalStateException(
          "Invalid URI in " + config.ingestUrlEnv() + ": " + invalid.getMessage(), invalid);
    }
    var path = parsed.getPath();
    var targetUri =
        (path == null || path.isEmpty() || "/".equals(path))
            ? parsed.resolve("/api/v1/ingest")
            : parsed;
    return Optional.of(new StatsEndpoint(targetUri, token.orElseThrow()));
  }

  @Override
  public String toString() {
    return "StatsEndpoint[ingestUri=" + ingestUri + ", bearerToken=<redacted>]";
  }
}
