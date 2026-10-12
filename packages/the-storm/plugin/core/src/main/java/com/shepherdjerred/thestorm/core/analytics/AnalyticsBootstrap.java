package com.shepherdjerred.thestorm.core.analytics;

import java.net.URI;
import java.util.Map;

/** Capture credentials and deployment identity; collection behavior belongs to Flipt. */
public record AnalyticsBootstrap(URI host, String projectToken, String stage) {
  public AnalyticsBootstrap {
    if ((!"https".equals(host.getScheme()) && !"http".equals(host.getScheme()))
        || host.getHost() == null
        || host.getUserInfo() != null
        || host.getQuery() != null
        || host.getFragment() != null
        || !"".equals(host.getPath())) {
      throw new IllegalArgumentException("Invalid PostHog ingestion host");
    }
    if (!projectToken.matches("phc_[A-Za-z0-9]+"))
      throw new IllegalArgumentException("Invalid PostHog project token");
    if (!"prod".equals(stage) && !"beta".equals(stage))
      throw new IllegalArgumentException("Invalid analytics deployment stage");
  }

  public static AnalyticsBootstrap fromEnvironment(Map<String, String> environment) {
    return new AnalyticsBootstrap(
        URI.create(required(environment, "POSTHOG_API_HOST")),
        required(environment, "POSTHOG_PROJECT_TOKEN"),
        required(environment, "FLIPT_ENVIRONMENT"));
  }

  private static String required(Map<String, String> environment, String key) {
    var value = environment.get(key);
    if (value == null || value.isBlank())
      throw new IllegalStateException("Missing bootstrap " + key);
    return value;
  }

  @Override
  public String toString() {
    return "AnalyticsBootstrap[host=" + host + ", projectToken=<redacted>, stage=" + stage + "]";
  }
}
