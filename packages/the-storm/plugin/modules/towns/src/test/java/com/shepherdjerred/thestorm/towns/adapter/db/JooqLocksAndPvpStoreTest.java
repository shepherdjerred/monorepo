package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpSetting;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Locks and PvP switches on a real SQLite file, migrated as the server migrates it. */
final class JooqLocksAndPvpStoreTest {

  private static final BlockPos LEFT = new BlockPos("world", -5, -60, 1_000_000);
  private static final BlockPos RIGHT = new BlockPos("world", -4, -60, 1_000_000);
  private static final Instant CHANGED = Instant.parse("2026-09-20T08:00:00Z");

  @TempDir Path directory;

  private StormDatabase database;
  private JooqLocksStore locks;
  private JooqPvpStore pvp;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("towns", JooqLocksAndPvpStoreTest.class.getClassLoader());
    locks = new JooqLocksStore(database);
    pvp = new JooqPvpStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }

  @Test
  void restoredJointOwnershipAndNamesRoundTripAndAreDeleted() throws Exception {
    var lock =
        new Lock(
            UUID.randomUUID(),
            OWNER,
            Set.of(LEFT, RIGHT),
            Map.of(),
            Lock.Options.NONE,
            new Lock.Restoration(
                UUID.randomUUID(), "parcel:shared", Map.of(OWNER, "Owner", MEMBER, "Member")));
    await(locks.save(lock));
    assertThat(await(locks.loadAll())).containsExactly(lock);
    await(locks.save(lock.withTrust(NOMAD, LockGrant.USE)));
    assertThat(await(locks.loadAll())).containsExactly(lock.withTrust(NOMAD, LockGrant.USE));
    await(locks.delete(lock.id()));
    assertThat(await(locks.loadAll())).isEmpty();
    int historicalOwners =
        await(database.read(dsl -> dsl.fetchCount(DSL.table("towns_lock_historical_owner"))));
    int restorations =
        await(database.read(dsl -> dsl.fetchCount(DSL.table("towns_lock_restoration"))));
    assertThat(historicalOwners).isZero();
    assertThat(restorations).isZero();
  }

  @Test
  void aLockWithBothHalvesAndItsTrustRoundTrips() throws Exception {
    var lock =
        new Lock(
            UUID.randomUUID(),
            OWNER,
            Set.of(LEFT, RIGHT),
            Map.of(NOMAD, LockGrant.USE, MEMBER, LockGrant.MANAGE),
            new Lock.Options(true, true),
            Lock.Restoration.NONE);

    await(locks.save(lock));

    assertThat(await(locks.loadAll())).containsExactly(lock);
  }

  @Test
  void savingALockAgainReplacesItsBlocksAndTrust() throws Exception {
    var lock =
        Lock.of(UUID.randomUUID(), OWNER, Set.of(LEFT, RIGHT)).withTrust(NOMAD, LockGrant.USE);
    await(locks.save(lock));

    var shrunk = lock.withoutBlock(LEFT).withoutTrust(NOMAD).withTrust(MEMBER, LockGrant.MANAGE);
    await(locks.save(shrunk));

    assertThat(await(locks.loadAll())).containsExactly(shrunk);
  }

  @Test
  void deletingALockRemovesEveryRowOfIt() throws Exception {
    var lock = Lock.of(UUID.randomUUID(), OWNER, Set.of(LEFT)).withTrust(NOMAD, LockGrant.USE);
    var other = Lock.of(UUID.randomUUID(), NOMAD, Set.of(RIGHT));
    await(locks.save(lock));
    await(locks.save(other));

    await(locks.delete(lock.id()));

    assertThat(await(locks.loadAll())).containsExactly(other);
    int trustRows = await(database.read(dsl -> dsl.fetchCount(DSL.table("towns_lock_trust"))));
    assertThat(trustRows).isZero();
    assertThatThrownBy(() -> await(locks.delete(lock.id()))).isInstanceOf(ExecutionException.class);
  }

  @Test
  void aBlockHoldsOneLock() throws Exception {
    await(locks.save(Lock.of(UUID.randomUUID(), OWNER, Set.of(LEFT))));

    assertThatThrownBy(() -> await(locks.save(Lock.of(UUID.randomUUID(), NOMAD, Set.of(LEFT)))))
        .isInstanceOf(ExecutionException.class);
  }

  @Test
  void aStoredLockWithoutBlocksFailsTheLoad() throws Exception {
    await(
        database.write(
            dsl ->
                dsl.execute(
                    "INSERT INTO towns_lock (id, owner_id) VALUES ('"
                        + UUID.randomUUID()
                        + "', '"
                        + OWNER
                        + "')")));

    assertThatThrownBy(() -> await(locks.loadAll())).isInstanceOf(ExecutionException.class);
  }

  @Test
  void pvpSwitchesRoundTripAndReplace() throws Exception {
    await(pvp.save(OWNER, new PvpSetting(false, CHANGED)));
    await(pvp.save(NOMAD, new PvpSetting(false, CHANGED)));
    await(pvp.save(NOMAD, new PvpSetting(true, CHANGED.plusSeconds(60))));

    assertThat(await(pvp.loadAll()))
        .containsOnly(
            Map.entry(OWNER, new PvpSetting(false, CHANGED)),
            Map.entry(NOMAD, new PvpSetting(true, CHANGED.plusSeconds(60))));
  }
}
