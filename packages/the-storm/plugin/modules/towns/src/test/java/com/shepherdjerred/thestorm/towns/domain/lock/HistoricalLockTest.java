package com.shepherdjerred.thestorm.towns.domain.lock;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.app.LockBook;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Restoration is explicit, quota exempt, durable, and shared only with its named owners. */
final class HistoricalLockTest {
  private static final UUID REQUEST = UUID.fromString("6903b19f-f4d2-42a5-91ba-6ce046562c83");
  private static final BlockPos CHEST = new BlockPos("world", 99, 64, -88);

  private static Lock shared() {
    return new Lock(
        UUID.randomUUID(),
        OWNER,
        Set.of(CHEST),
        Map.of(),
        Lock.Options.NONE,
        new Lock.Restoration(
            REQUEST, "parcel:anteron-zah-shop", Map.of(OWNER, "Anteron", MEMBER, "Zah262")));
  }

  private static LockAccess access() {
    return new LockAccess(
        new LockAccess.Towns() {
          @Override
          public Optional<UUID> townIdOf(UUID player) {
            return Optional.of(REQUEST);
          }

          @Override
          public boolean manages(UUID player, UUID town) {
            return false;
          }
        });
  }

  @Test
  void everyJointOwnerCanOpenBreakUnlockAndManageTrust() {
    var lock = shared();
    for (var owner : List.of(OWNER, MEMBER)) {
      assertThat(access().open(lock, owner, false, Optional.empty()))
          .contains(LockAccess.Right.OWNER);
      assertThat(access().breaking(lock, owner, false, Optional.empty()))
          .contains(LockAccess.Right.OWNER);
      assertThat(access().unlocking(lock, owner, false, Optional.empty()))
          .contains(LockAccess.Right.OWNER);
      assertThat(
              LockRules.trust(
                      owner,
                      Optional.of(lock),
                      new PlayerRef(NOMAD, "Nomad"),
                      Optional.of(LockGrant.USE))
                  .isOk())
          .isTrue();
      assertThat(LockRules.shareWithTown(owner, Optional.of(lock), true).isOk()).isTrue();
      assertThat(LockRules.redstone(owner, Optional.of(lock), true).isOk()).isTrue();
    }
    assertThat(
            LockRules.trust(
                    OWNER,
                    Optional.of(lock),
                    new PlayerRef(MEMBER, "Zah262"),
                    Optional.of(LockGrant.MANAGE))
                .isOk())
        .isFalse();
  }

  @Test
  void townMembershipDoesNotGrantHistoricalChestAccess() {
    var lock = shared();
    assertThat(access().open(lock, NOMAD, false, Optional.of(REQUEST))).isEmpty();
    assertThat(access().breaking(lock, NOMAD, false, Optional.of(REQUEST))).isEmpty();
    assertThat(access().unlocking(lock, NOMAD, false, Optional.of(REQUEST))).isEmpty();
    assertThat(
            LockRules.trust(
                    NOMAD,
                    Optional.of(lock),
                    new PlayerRef(MEMBER, "Member"),
                    Optional.of(LockGrant.USE))
                .isOk())
        .isFalse();
  }

  @Test
  void custodyRequiresStaffBypass() {
    var custody = Lock.Restoration.CUSTODIAN;
    var lock =
        new Lock(
            UUID.randomUUID(),
            custody,
            Set.of(CHEST),
            Map.of(),
            Lock.Options.NONE,
            new Lock.Restoration(
                REQUEST, "heritage:unidentified", Map.of(custody, "Staff custody")));
    assertThat(access().open(lock, OWNER, false, Optional.empty())).isEmpty();
    assertThat(access().open(lock, OWNER, true, Optional.empty()))
        .contains(LockAccess.Right.BYPASS);
  }

  @Test
  void importedLocksDoNotConsumeTheNormalAllowance() {
    var book = new LockBook();
    var restored = shared();
    book.put(restored);
    assertThat(book.countOf(OWNER)).isZero();
    assertThat(book.countOf(MEMBER)).isZero();
    var ordinary = Lock.of(UUID.randomUUID(), OWNER, Set.of(new BlockPos("world", 0, 64, 0)));
    book.put(ordinary);
    book.put(restored.withTrust(NOMAD, LockGrant.USE));
    assertThat(book.countOf(OWNER)).isEqualTo(1);
    var attempt =
        new LockAttempt(
            OWNER,
            List.of(new BlockPos("world", 1, 64, 0)),
            new LockAttempt.Standing(OWNER, true, LockAttempt.Ground.OPEN, false),
            UUID.randomUUID());
    assertThat(LockRules.lock(attempt, book, new LockPolicy(1, true)).isOk()).isFalse();
    book.remove(restored.id());
    assertThat(book.countOf(OWNER)).isEqualTo(1);
    book.remove(ordinary.id());
    assertThat(book.countOf(OWNER)).isZero();
  }

  @Test
  void worldAndPermissionChangesRetainHistoricalProvenance() {
    var lock = shared();
    var other = new BlockPos("world", 100, 64, -88);
    assertThat(
            lock.withBlock(other)
                .withoutBlock(other)
                .withTrust(NOMAD, LockGrant.USE)
                .withoutTrust(NOMAD)
                .withOptions(new Lock.Options(false, true))
                .restoration())
        .isEqualTo(lock.restoration());
    assertThatThrownBy(() -> lock.ownedBy(NOMAD)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void incompleteOrConflictingRestorationMetadataFails() {
    assertThatThrownBy(() -> new Lock.Restoration(REQUEST, "parcel:shop", Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new Lock.Restoration(new UUID(0, 0), "parcel:shop", Map.of(OWNER, "Owner")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Lock(
                    UUID.randomUUID(),
                    NOMAD,
                    Set.of(CHEST),
                    Map.of(),
                    Lock.Options.NONE,
                    shared().restoration()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> shared().withTrust(MEMBER, LockGrant.USE))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
