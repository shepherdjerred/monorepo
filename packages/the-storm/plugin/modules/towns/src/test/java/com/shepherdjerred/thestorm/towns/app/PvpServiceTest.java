package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpPolicy;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpProblem;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpSetting;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

/** Players' own PvP switches: on by default, changed once a week, saved and undone on failure. */
final class PvpServiceTest {

  private static final Instant START = Instant.parse("2026-09-25T12:00:00Z");

  private final MembershipServiceTest.MutableClock clock =
      new MembershipServiceTest.MutableClock(START);
  private final FakePvpStore store = new FakePvpStore();
  private final PvpService pvp =
      new PvpService(
          store,
          new PvpPolicy(168, 30),
          new Clocks(clock, new SplittableRandom(1), Runnable::run, failure -> {}));

  @Test
  void everyoneStartsWithPvpOnAndMayChangeItAtOnce() {
    assertThat(pvp.pvpOn(OWNER)).isTrue();
    assertThat(pvp.nextChange(OWNER)).isEmpty();

    var change = pvp.set(OWNER, false);

    assertThat(change.isOk()).isTrue();
    assertThat(pvp.pvpOn(OWNER)).isFalse();
    assertThat(pvp.pvpOn(NOMAD)).isTrue();
    store.pending.complete(null);
    assertThat(store.saved).containsEntry(OWNER, new PvpSetting(false, START));
  }

  @Test
  void theNextChangeWaitsAWeek() {
    var _ = pvp.set(OWNER, false);
    store.pending.complete(null);

    clock.advance(Duration.ofDays(6));
    assertThat(pvp.set(OWNER, true))
        .isEqualTo(Result.err(new PvpProblem.TooSoon(START.plus(Duration.ofDays(7)))));
    assertThat(pvp.nextChange(OWNER)).contains(START.plus(Duration.ofDays(7)));

    clock.advance(Duration.ofDays(1));
    assertThat(pvp.set(OWNER, true).isOk()).isTrue();
    assertThat(pvp.pvpOn(OWNER)).isFalse();
    store.pending.complete(null);
    assertThat(pvp.pvpOn(OWNER)).isTrue();
  }

  @Test
  void askingForTheCurrentSettingChangesNothing() {
    assertThat(pvp.set(OWNER, true)).isEqualTo(Result.err(new PvpProblem.AlreadySet(true)));
  }

  @Test
  void aFailedSaveIsUndoneByReloading() {
    var change = pvp.set(OWNER, false);

    store.pending.completeExceptionally(new IllegalStateException("disk full"));

    assertThat(pvp.pvpOn(OWNER)).isTrue();
    assertThat(savedOf(change)).isCompletedExceptionally();
  }

  @Test
  void aSwitchBeingSavedCannotChangeAgain() {
    var _ = pvp.set(OWNER, false);

    assertThat(pvp.set(OWNER, true)).isEqualTo(Result.err(new PvpProblem.Busy()));
  }

  @Test
  void storedSwitchesLoad() {
    pvp.load(Map.of(NOMAD, new PvpSetting(false, START.minus(Duration.ofDays(1)))));

    assertThat(pvp.pvpOn(NOMAD)).isFalse();
    assertThat(pvp.nextChange(NOMAD)).contains(START.plus(Duration.ofDays(6)));
  }

  @Test
  void bothCombatantsCannotEscapeTheFightByTogglingPvp() {
    pvp.recordFight(OWNER, NOMAD);
    var until = START.plusSeconds(30);

    assertThat(pvp.set(OWNER, false)).isEqualTo(Result.err(new PvpProblem.InFight(until)));
    assertThat(pvp.set(NOMAD, false)).isEqualTo(Result.err(new PvpProblem.InFight(until)));
    assertThat(pvp.nextChange(OWNER)).contains(until);
    assertThat(pvp.nextChange(NOMAD)).contains(until);
    assertThat(store.saved).isEmpty();

    clock.advance(Duration.ofSeconds(30));
    assertThat(pvp.nextChange(OWNER)).isEmpty();
    assertThat(pvp.set(OWNER, false).isOk()).isTrue();
    store.pending.complete(null);
    assertThat(pvp.pvpOn(OWNER)).isFalse();
  }

  /** Keeps what was saved; the one outstanding write is completed by the test. */
  private static final class FakePvpStore implements PvpStore {

    final Map<UUID, PvpSetting> saved = new HashMap<>();
    CompletableFuture<Void> pending = new CompletableFuture<>();

    @Override
    public CompletableFuture<Map<UUID, PvpSetting>> loadAll() {
      return CompletableFuture.completedFuture(Map.copyOf(saved));
    }

    @Override
    public CompletableFuture<Void> save(UUID player, PvpSetting setting) {
      pending = new CompletableFuture<>();
      return pending.thenRun(() -> saved.put(player, setting));
    }
  }

  private static CompletableFuture<Void> savedOf(Result<Change<PvpSetting>, PvpProblem> change) {
    return switch (change) {
      case Result.Ok<Change<PvpSetting>, PvpProblem>(var ok) -> ok.saved();
      case Result.Err<Change<PvpSetting>, PvpProblem>(var problem) ->
          throw new AssertionError("expected a change, got " + problem);
    };
  }
}
