package com.shepherdjerred.thestorm.towns.domain.lock;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Public, password, donation, supply and display locks, and the flags stored with them. */
final class LockTypeTest {

  private static final BlockPos CHEST = new BlockPos("world", 0, 64, 0);
  private static final UUID ID = UUID.fromString("00000000-0000-4000-8000-0000000000bb");

  private final LockAccess access =
      new LockAccess(
          new LockAccess.Towns() {
            @Override
            public Optional<UUID> townIdOf(UUID player) {
              return Optional.empty();
            }

            @Override
            public boolean manages(UUID player, UUID townId) {
              return false;
            }
          });

  @Test
  void strangersUseAPublicLockAndCannotUseAPrivateOne() {
    var priv = Lock.of(ID, OWNER, Set.of(CHEST));
    var open = priv.withType(LockType.PUBLIC, "");

    assertThat(access.open(priv, NOMAD, false, Optional.empty())).isEmpty();
    assertThat(access.open(open, NOMAD, false, Optional.empty())).contains(LockAccess.Right.PUBLIC);
    assertThat(access.movement(open, NOMAD, false, Optional.empty()))
        .isEqualTo(LockAccess.Movement.FULL);
  }

  @Test
  void aPasswordLastsOnlyForSomeoneWhoKnowsIt() {
    var lock = Lock.of(ID, OWNER, Set.of(CHEST)).withType(LockType.PASSWORD, "gate");

    assertThat(access.open(lock, NOMAD, false, Optional.empty())).isEmpty();
    assertThat(
            access.open(lock, NOMAD, false, new LockAccess.Approach(Optional.empty(), true, false)))
        .contains(LockAccess.Right.PASSWORD);
    assertThat(access.movement(lock, OWNER, false, Optional.empty()))
        .isEqualTo(LockAccess.Movement.FULL);
  }

  @Test
  void donationSupplyAndDisplayLimitStrangers() {
    var donation = Lock.of(ID, OWNER, Set.of(CHEST)).withType(LockType.DONATION, "");
    var supply = donation.withType(LockType.SUPPLY, "");
    var display = donation.withType(LockType.DISPLAY, "");

    assertThat(access.movement(donation, NOMAD, false, Optional.empty()))
        .isEqualTo(LockAccess.Movement.PUT);
    assertThat(access.movement(supply, NOMAD, false, Optional.empty()))
        .isEqualTo(LockAccess.Movement.TAKE);
    assertThat(access.movement(display, NOMAD, false, Optional.empty()))
        .isEqualTo(LockAccess.Movement.LOOK);
    assertThat(access.movement(donation, OWNER, false, Optional.empty()))
        .isEqualTo(LockAccess.Movement.FULL);
  }

  @Test
  void onlyTheOwnerChangesTypeAndAPasswordNeedsAWord() {
    var found = Lock.of(ID, OWNER, Set.of(CHEST));
    var lock = Optional.of(found);

    assertThat(LockRules.type(OWNER, lock, LockType.DONATION, ""))
        .isEqualTo(Result.ok(found.withType(LockType.DONATION, "")));
    assertThat(LockRules.type(NOMAD, lock, LockType.PUBLIC, ""))
        .isEqualTo(Result.err(List.of(new LockProblem.NotYourLock())));
    assertThat(LockRules.type(OWNER, lock, LockType.PASSWORD, "  "))
        .isEqualTo(Result.err(List.of(new LockProblem.PasswordMissing())));
    assertThatThrownBy(
            () ->
                new Lock.Options(
                    false,
                    false,
                    LockType.PUBLIC,
                    "secret",
                    Lock.Flags.NONE,
                    Set.of(),
                    Set.of(),
                    Instant.EPOCH))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void flagsStayWithTheLockWhenSharingChanges() {
    var lock =
        Lock.of(ID, OWNER, Set.of(CHEST))
            .withType(LockType.SUPPLY, "")
            .withFlag(LockFlag.HOPPER_OUT, true);

    var shared =
        switch (LockRules.shareWithTown(OWNER, Optional.of(lock), true)) {
          case Result.Ok(var value) -> value;
          case Result.Err(var error) -> throw new AssertionError(error);
        };

    assertThat(shared.options().type()).isEqualTo(LockType.SUPPLY);
    assertThat(shared.options().flags().hopperOut()).isTrue();
    assertThat(shared.options().sharedWithTown()).isTrue();
  }

  @Test
  void anAdminEditsTheListButCannotBreakOrUnlock() {
    var admin = UUID.fromString("00000000-0000-4000-8000-0000000000aa");
    var lock = Lock.of(ID, OWNER, Set.of(CHEST)).withTrust(admin, LockGrant.ADMIN);

    assertThat(access.open(lock, admin, false, Optional.empty()))
        .contains(LockAccess.Right.TRUSTED);
    assertThat(access.breaking(lock, admin, false, Optional.empty())).isEmpty();
    assertThat(access.unlocking(lock, admin, false, Optional.empty())).isEmpty();
    assertThat(
            LockRules.trust(
                admin,
                Optional.of(lock),
                new PlayerRef(NOMAD, "Nomad"),
                Optional.of(LockGrant.USE)))
        .isInstanceOf(Result.Ok.class);
    assertThat(LockRules.unlock(Optional.of(lock), false))
        .isEqualTo(Result.err(List.of(new LockProblem.NotYourLock())));
  }

  @Test
  void aGroupOrNamedTownMayOpen() {
    var town = UUID.fromString("00000000-0000-4000-8000-0000000000c1");
    var towns =
        new LockAccess(
            new LockAccess.Towns() {
              @Override
              public Optional<UUID> townIdOf(UUID player) {
                return player.equals(NOMAD) ? Optional.of(town) : Optional.empty();
              }

              @Override
              public boolean manages(UUID player, UUID townId) {
                return false;
              }
            });
    var grouped =
        Lock.of(ID, OWNER, Set.of(CHEST))
            .withOptions(Lock.of(ID, OWNER, Set.of(CHEST)).options().withGroups(Set.of("friends")));
    var townLock =
        Lock.of(ID, OWNER, Set.of(CHEST)).withOptions(grouped.options().withTowns(Set.of(town)));

    assertThat(
            access.open(
                grouped, NOMAD, false, new LockAccess.Approach(Optional.empty(), false, true)))
        .contains(LockAccess.Right.TRUSTED);
    assertThat(access.open(grouped, NOMAD, false, Optional.empty())).isEmpty();
    assertThat(towns.open(townLock, NOMAD, false, Optional.empty()))
        .contains(LockAccess.Right.TOWN);
  }

  @Test
  void expiryAndPurgeSkipExemptLocks() {
    var old = Lock.of(ID, OWNER, Set.of(CHEST));
    var kept = old.withFlag(LockFlag.EXEMPT, true);
    var now = Instant.parse("2026-01-31T00:00:00Z");

    assertThat(LockRules.expired(List.of(old, kept), now, 30)).containsExactly(old);
    assertThat(LockRules.purge(List.of(old, kept), owner -> owner.equals(OWNER)))
        .containsExactly(old);
  }
}
