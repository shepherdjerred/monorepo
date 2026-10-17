package com.shepherdjerred.thestorm.core.expansion;

import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

final class ManagedGameplayTest {
  @Test
  void successfulFalseNeverFallsThroughToTheDefault() {
    var actor = randomUUID();
    var gameplay =
        new ManagedGameplay((key, id) -> CompletableFuture.completedFuture(false), () -> {});
    assertThat(
            gameplay
                .enabledOrDefault(
                    ManagedGameplay.CONTENT_SAFETY,
                    actor,
                    true,
                    failure -> {
                      throw new AssertionError("Successful false is not an outage");
                    })
                .join())
        .isFalse();
    assertThat(gameplay.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, actor)).contains(false);
  }

  @Test
  void providerOutagesUseAnObservedDefaultWithTheNormalCacheLifetime() {
    var actor = randomUUID();
    var now = new AtomicReference<>(Instant.EPOCH);
    var seen = new AtomicReference<Throwable>();
    var gameplay =
        new ManagedGameplay(
            (key, id) ->
                CompletableFuture.failedFuture(
                    new FlagProviderUnavailableException(
                        new java.io.IOException("provider offline"))),
            () -> {},
            false,
            (InstantSource) now::get);
    assertThat(
            gameplay
                .enabledOrDefault(ManagedGameplay.CONTENT_SAFETY, actor, false, seen::set)
                .join())
        .isFalse();
    assertThat(seen.get()).isInstanceOf(FlagProviderUnavailableException.class);
    assertThat(gameplay.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, actor)).contains(false);
    now.set(Instant.EPOCH.plusSeconds(31));
    assertThat(gameplay.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, actor)).isEmpty();
  }

  @Test
  void brokenFlagContractsDoNotBecomeDisabledAnswers() {
    var actor = randomUUID();
    var gameplay =
        new ManagedGameplay(
            (key, id) ->
                CompletableFuture.failedFuture(
                    new IllegalStateException("rollout response lacks enabled")),
            () -> {});
    assertThatThrownBy(
            () ->
                gameplay
                    .enabledOrDefault(ManagedGameplay.CONTENT_SAFETY, actor, false, failure -> {})
                    .join())
        .hasRootCauseMessage("rollout response lacks enabled");
    assertThat(gameplay.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, actor)).isEmpty();
  }

  @Test
  void completedRolloutsAreCachedBrieflyForNonblockingBoundaries() {
    var now = new AtomicReference<>(Instant.EPOCH);
    var actor = randomUUID();
    var gameplay =
        new ManagedGameplay(
            (key, id) -> CompletableFuture.completedFuture(true),
            () -> {},
            false,
            (InstantSource) now::get);

    assertThat(gameplay.cachedEnabled(ManagedGameplay.IP, actor)).isEmpty();
    assertThat(gameplay.enabled(ManagedGameplay.IP, actor).join()).isTrue();
    assertThat(gameplay.cachedEnabled(ManagedGameplay.IP, actor)).contains(true);

    now.set(Instant.EPOCH.plus(Duration.ofSeconds(31)));

    assertThat(gameplay.cachedEnabled(ManagedGameplay.IP, actor)).isEmpty();
    assertThat(gameplay.lastKnownEnabled(ManagedGameplay.IP, actor)).contains(true);
  }
}
