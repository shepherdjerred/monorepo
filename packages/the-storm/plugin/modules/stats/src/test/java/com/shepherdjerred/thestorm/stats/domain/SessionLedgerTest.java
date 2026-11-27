package com.shepherdjerred.thestorm.stats.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

final class SessionLedgerTest {

  private static final UUID ALICE = UUID.fromString("11111111-1111-4111-8111-111111111111");

  private final AtomicLong counter = new AtomicLong(1);
  private final SessionLedger ledger =
      new SessionLedger(() -> new UUID(0x4000_0000_0000_0000L, counter.getAndIncrement()));

  @Test
  void tracksJoinWorldModeAfkSplitsPingSummaryAndQuit() {
    var t0 = Instant.parse("2026-11-22T18:00:00Z");
    var joined =
        ledger
            .join(
                new SessionLedger.JoinInput(
                    ALICE,
                    "Alice",
                    t0,
                    Platform.JAVA,
                    "26.3",
                    "vanilla",
                    "ts-mc.net:25565",
                    WorldBucket.WORLD,
                    GameModeBucket.SURVIVAL,
                    false,
                    "US",
                    "United States"))
            .orElseThrow();

    assertThat(joined.sessionsDelta()).isEqualTo(1);
    assertThat(joined.events()).hasSize(1);
    var started = (SessionLedger.LedgerEvent.Started) joined.events().getFirst();
    assertThat(started.joinAddress()).isEqualTo("ts-mc.net");
    assertThat(started.countryCode()).isEqualTo("US");
    assertThat(started.countryName()).isEqualTo("United States");

    // Same state at t0+10s only records ping without splitting interval prematurely
    assertThat(
            ledger.update(
                ALICE,
                new SessionLedger.StateSample(
                    t0.plusSeconds(10), WorldBucket.WORLD, GameModeBucket.SURVIVAL, false, 0)))
        .isEmpty();

    // World change at t0+30s splits [t0, t0+30s] as survival in world
    var worldChange =
        ledger
            .update(
                ALICE,
                new SessionLedger.StateSample(
                    t0.plusSeconds(30), WorldBucket.SKYLANDS, GameModeBucket.SURVIVAL, false, 40))
            .orElseThrow();
    assertThat(worldChange.connectedMsDelta()).isEqualTo(30_000L);
    assertThat(worldChange.activeMsDelta()).isEqualTo(30_000L);
    var firstInterval = (SessionLedger.LedgerEvent.Interval) worldChange.events().getFirst();
    assertThat(firstInterval.world()).isEqualTo(WorldBucket.WORLD);
    assertThat(firstInterval.pingMs()).isEqualTo(40);

    // Marked AFK at t0+50s splits [t0+30s, t0+50s] active in skylands
    var afkStart =
        ledger
            .update(
                ALICE,
                new SessionLedger.StateSample(
                    t0.plusSeconds(50), WorldBucket.SKYLANDS, GameModeBucket.SURVIVAL, true, 60))
            .orElseThrow();
    assertThat(afkStart.connectedMsDelta()).isEqualTo(20_000L);
    assertThat(afkStart.activeMsDelta()).isEqualTo(20_000L);

    // Quit at t0+80s splits [t0+50s, t0+80s] with activeMs = 0 (AFK) and emits session_ended
    var left =
        ledger
            .leave(
                new SessionLedger.LeaveInput(ALICE, t0.plusSeconds(80), EndReason.DISCONNECT, 50))
            .orElseThrow();
    assertThat(left.connectedMsDelta()).isEqualTo(30_000L);
    assertThat(left.activeMsDelta()).isZero();
    assertThat(left.events()).hasSize(2);

    var ended = (SessionLedger.LedgerEvent.Ended) left.events().get(1);
    assertThat(ended.connectedMs()).isEqualTo(80_000L);
    assertThat(ended.activeMs()).isEqualTo(50_000L);
    assertThat(ended.endReason()).isEqualTo(EndReason.DISCONNECT);
    // Initial 0 ping ignored because real positive pings (40, 60, 50) were observed!
    assertThat(ended.pingMinMs()).isEqualTo(40);
    assertThat(ended.pingAvgMs()).isEqualTo(50);
    assertThat(ended.pingMaxMs()).isEqualTo(60);
  }

  @Test
  void clampsBackwardsClockAndSplitsAcrossPacificMidnight() {
    // 2026-11-22 23:59:30 PST is 2026-11-23T07:59:30Z
    var beforeMidnight = Instant.parse("2026-11-23T07:59:30Z");
    ledger.join(
        new SessionLedger.JoinInput(
            ALICE,
            "Alice",
            beforeMidnight,
            Platform.JAVA,
            "26.3",
            null,
            null,
            WorldBucket.WORLD,
            GameModeBucket.SURVIVAL,
            false,
            null,
            null));

    // Clock moves backwards -> clamped to 0, no negative durations
    assertThat(
            ledger.checkpoint(
                ALICE,
                new SessionLedger.StateSample(
                    beforeMidnight.minusSeconds(5),
                    WorldBucket.WORLD,
                    GameModeBucket.SURVIVAL,
                    false,
                    0)))
        .isEmpty();

    // Advance 90s across Pacific midnight -> 2 intervals (30s + 60s)
    var crossed =
        ledger
            .checkpoint(
                ALICE,
                new SessionLedger.StateSample(
                    beforeMidnight.plusSeconds(90),
                    WorldBucket.WORLD,
                    GameModeBucket.SURVIVAL,
                    false,
                    0))
            .orElseThrow();
    assertThat(crossed.events()).hasSize(2);
    assertThat(crossed.connectedMsDelta()).isEqualTo(90_000L);

    var shutdown = ledger.shutdown(beforeMidnight.plusSeconds(90));
    assertThat(shutdown).hasSize(1);
    var ended = (SessionLedger.LedgerEvent.Ended) shutdown.getFirst().events().getLast();
    assertThat(ended.endReason()).isEqualTo(EndReason.SHUTDOWN);
    assertThat(ended.pingMinMs()).isZero();
    assertThat(ended.pingAvgMs()).isZero();
    assertThat(ended.pingMaxMs()).isZero();
  }

  @Test
  void updateAfkSplitsAwayAndActiveIntervalsBetweenSamplerTicks() {
    var t0 = Instant.parse("2026-11-22T18:00:00Z");
    ledger.join(
        new SessionLedger.JoinInput(
            ALICE,
            "Alice",
            t0,
            Platform.JAVA,
            "26.3",
            "vanilla",
            "ts-mc.net",
            WorldBucket.WORLD,
            GameModeBucket.SURVIVAL,
            false,
            null,
            null));

    // Active for 12s, then enters AFK
    var enteredAfk = ledger.updateAfk(ALICE, t0.plusSeconds(12), true).orElseThrow();
    assertThat(enteredAfk.connectedMsDelta()).isEqualTo(12_000L);
    assertThat(enteredAfk.activeMsDelta()).isEqualTo(12_000L);

    // Away for 30s, then returns active before 60s sampler tick
    var exitedAfk = ledger.updateAfk(ALICE, t0.plusSeconds(42), false).orElseThrow();
    assertThat(exitedAfk.connectedMsDelta()).isEqualTo(30_000L);
    assertThat(exitedAfk.activeMsDelta()).isZero();

    // Periodic sampler tick at 60s records only the remaining 18s as active
    var tick =
        ledger
            .checkpoint(
                ALICE,
                new SessionLedger.StateSample(
                    t0.plusSeconds(60), WorldBucket.WORLD, GameModeBucket.SURVIVAL, false, 35))
            .orElseThrow();
    assertThat(tick.connectedMsDelta()).isEqualTo(18_000L);
    assertThat(tick.activeMsDelta()).isEqualTo(18_000L);
    var openSession = java.util.Objects.requireNonNull(tick.openSession());
    assertThat(openSession.connectedMs()).isEqualTo(60_000L);
    assertThat(openSession.activeMs()).isEqualTo(30_000L);
  }
}
