package com.shepherdjerred.thestorm.core.expansion;

import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

final class ManagedGameplayTest {
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
  }
}
