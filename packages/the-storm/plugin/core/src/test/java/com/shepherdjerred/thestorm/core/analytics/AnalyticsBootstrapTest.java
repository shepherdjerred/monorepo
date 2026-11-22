package com.shepherdjerred.thestorm.core.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

final class AnalyticsBootstrapTest {
  @Test
  void derivesAnalyticsStageFromFlagsDeployment() {
    assertThat(
            AnalyticsBootstrap.fromEnvironment(
                    Map.of(
                        "POSTHOG_API_HOST",
                        "https://posthog.example.com",
                        "POSTHOG_PROJECT_TOKEN",
                        "phc_test123",
                        "FLAGS_DEPLOYMENT",
                        "minecraft/tsmc"))
                .stage())
        .isEqualTo("prod");
    assertThat(
            AnalyticsBootstrap.fromEnvironment(
                    Map.of(
                        "POSTHOG_API_HOST",
                        "https://posthog.example.com",
                        "POSTHOG_PROJECT_TOKEN",
                        "phc_test123",
                        "FLAGS_DEPLOYMENT",
                        "the-storm/prod"))
                .stage())
        .isEqualTo("prod");
    assertThat(
            AnalyticsBootstrap.fromEnvironment(
                    Map.of(
                        "POSTHOG_API_HOST",
                        "https://posthog.example.com",
                        "POSTHOG_PROJECT_TOKEN",
                        "phc_test123",
                        "FLAGS_DEPLOYMENT",
                        "minecraft/sandbox"))
                .stage())
        .isEqualTo("beta");
    assertThat(
            AnalyticsBootstrap.fromEnvironment(
                    Map.of(
                        "POSTHOG_API_HOST",
                        "https://posthog.example.com",
                        "POSTHOG_PROJECT_TOKEN",
                        "phc_test123",
                        "FLAGS_DEPLOYMENT",
                        "the-storm/beta"))
                .stage())
        .isEqualTo("beta");
  }

  @Test
  void refusesMissingOrUnrecognizedFlagsDeployment() {
    assertThatThrownBy(() ->
            AnalyticsBootstrap.fromEnvironment(
                Map.of(
                    "POSTHOG_API_HOST",
                    "https://posthog.example.com",
                    "POSTHOG_PROJECT_TOKEN",
                    "phc_test123")))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("FLAGS_DEPLOYMENT");
    assertThatThrownBy(() ->
            AnalyticsBootstrap.fromEnvironment(
                Map.of(
                    "POSTHOG_API_HOST",
                    "https://posthog.example.com",
                    "POSTHOG_PROJECT_TOKEN",
                    "phc_test123",
                    "FLAGS_DEPLOYMENT",
                    "the-storm/staging")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
