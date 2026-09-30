package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.FOUNDED;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OTHER_TOWN_OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.app.TownPayout;
import com.shepherdjerred.thestorm.towns.app.TownsSnapshot;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
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

/** The towns tables on a real SQLite file, migrated by Flyway. */
final class JooqTownsStoreTest {

  private static final Instant CLAIMED = Instant.parse("2026-09-10T00:00:00Z");

  @TempDir Path directory;

  private StormDatabase database;
  private JooqTownsStore store;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("towns", JooqTownsStoreTest.class.getClassLoader());
    store = new JooqTownsStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }

  private TownsSnapshot load() throws Exception {
    return await(store.loadAll());
  }

  @Test
  void anEmptyDatabaseLoadsNothing() throws Exception {
    assertThat(load()).isEqualTo(new TownsSnapshot(java.util.List.of(), java.util.List.of()));
  }

  @Test
  void townsMembersClaimsAndFlagsRoundTrip() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.createTown(Fixtures.townB()));
    await(store.addClaim(claim(TOWN_A, 0, 0, ClaimFlag.PVP, ClaimFlag.PUBLIC_SWITCHES), CLAIMED));
    await(store.addClaim(claim(TOWN_A, -1, 0), CLAIMED.plusSeconds(1)));
    await(store.addClaim(claim(TOWN_B, 30, -30), CLAIMED.plusSeconds(2)));

    var snapshot = load();

    assertThat(snapshot.towns()).containsExactlyInAnyOrder(Fixtures.townA(), Fixtures.townB());
    assertThat(snapshot.claims())
        .containsExactly(
            claim(TOWN_A, 0, 0, ClaimFlag.PVP, ClaimFlag.PUBLIC_SWITCHES),
            claim(TOWN_A, -1, 0),
            claim(TOWN_B, 30, -30));
  }

  @Test
  void savingFlagsReplacesThem() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.addClaim(claim(TOWN_A, 0, 0, ClaimFlag.PVP), CLAIMED));

    await(store.saveClaim(claim(TOWN_A, 0, 0, ClaimFlag.EXPLOSIONS, ClaimFlag.FIRE_SPREAD)));

    assertThat(load().claims())
        .containsExactly(claim(TOWN_A, 0, 0, ClaimFlag.EXPLOSIONS, ClaimFlag.FIRE_SPREAD));
  }

  @Test
  void savingFlagsForAnotherTownsClaimFails() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.createTown(Fixtures.townB()));
    await(store.addClaim(claim(TOWN_A, 0, 0), CLAIMED));

    assertThatThrownBy(() -> await(store.saveClaim(claim(TOWN_B, 0, 0, ClaimFlag.PVP))))
        .isInstanceOf(ExecutionException.class);
    assertThat(load().claims()).containsExactly(claim(TOWN_A, 0, 0));
  }

  @Test
  void removingAClaimRemovesItsFlags() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.addClaim(claim(TOWN_A, 0, 0, ClaimFlag.PVP), CLAIMED));

    await(store.removeClaim(Fixtures.chunk(0, 0)));

    assertThat(load().claims()).isEmpty();
    assertThat(flagRows()).isZero();
    assertThatThrownBy(() -> await(store.removeClaim(Fixtures.chunk(0, 0))))
        .isInstanceOf(ExecutionException.class);
  }

  @Test
  void deletingATownRemovesItsMembersClaimsAndFlagsOnly() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.createTown(Fixtures.townB()));
    await(store.addClaim(claim(TOWN_A, 0, 0, ClaimFlag.PVP), CLAIMED));
    await(store.addClaim(claim(TOWN_B, 10, 0, ClaimFlag.PVP), CLAIMED));

    await(store.deleteTown(TownPayout.of(Fixtures.townA())));

    var snapshot = load();
    assertThat(snapshot.towns()).containsExactly(Fixtures.townB());
    assertThat(snapshot.claims()).containsExactly(claim(TOWN_B, 10, 0, ClaimFlag.PVP));
    assertThat(flagRows()).isEqualTo(1);
    await(store.createTown(Fixtures.townA()));
    assertThatThrownBy(
            () ->
                await(
                    store.deleteTown(new TownPayout(UUID.randomUUID(), OWNER, UUID.randomUUID()))))
        .isInstanceOf(ExecutionException.class);
  }

  @Test
  void aChunkHoldsOneClaim() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.createTown(Fixtures.townB()));
    await(store.addClaim(claim(TOWN_A, 0, 0), CLAIMED));

    assertThatThrownBy(() -> await(store.addClaim(claim(TOWN_B, 0, 0), CLAIMED)))
        .isInstanceOf(ExecutionException.class);
    assertThat(load().claims()).containsExactly(claim(TOWN_A, 0, 0));
  }

  @Test
  void aClaimNeedsAStoredTown() {
    assertThatThrownBy(() -> await(store.addClaim(claim(TOWN_A, 0, 0), CLAIMED)))
        .isInstanceOf(ExecutionException.class);
  }

  @Test
  void townNamesAreUniqueIgnoringCase() throws Exception {
    await(store.createTown(Fixtures.townA()));

    assertThatThrownBy(
            () -> await(store.createTown(Town.found(UUID.randomUUID(), "AEGIS", FOUNDED, NOMAD))))
        .isInstanceOf(ExecutionException.class);
    assertThat(load().towns()).containsExactly(Fixtures.townA());
  }

  @Test
  void aPlayerBelongsToOneTown() throws Exception {
    await(store.createTown(Fixtures.townA()));

    assertThatThrownBy(
            () ->
                await(store.createTown(Town.found(UUID.randomUUID(), "Carthage", FOUNDED, OWNER))))
        .isInstanceOf(ExecutionException.class);
    assertThat(load().towns()).containsExactly(Fixtures.townA());
  }

  @Test
  void anUnknownStoredFlagFailsTheLoad() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.addClaim(claim(TOWN_A, 0, 0), CLAIMED));
    // The CHECK constraint keeps bad flags out; drop it by rebuilding the table, as a bad
    // hand-edit or a half-applied future migration might.
    await(
        database.write(
            dsl -> {
              dsl.execute("PRAGMA foreign_keys = OFF");
              dsl.execute("ALTER TABLE towns_claim_flag RENAME TO old_flags");
              dsl.execute(
                  "CREATE TABLE towns_claim_flag (world TEXT, chunk_x INTEGER, chunk_z INTEGER,"
                      + " flag TEXT)");
              dsl.execute("INSERT INTO towns_claim_flag VALUES ('world', 0, 0, 'FLYING')");
              return 0;
            }));

    assertThatThrownBy(this::load).isInstanceOf(ExecutionException.class);
  }

  @Test
  void governorLevelsAndClaimTrustRoundTrip() throws Exception {
    var town = Fixtures.townA().withGovernorLevel(4);
    await(store.createTown(town));
    var trusted = claim(TOWN_A, 0, 0, ClaimFlag.PVP).withTrust(NOMAD, true);
    await(store.addClaim(trusted, CLAIMED));

    var snapshot = load();

    assertThat(snapshot.towns()).containsExactly(town);
    assertThat(snapshot.claims()).containsExactly(trusted);
  }

  @Test
  void savingAClaimReplacesItsTrust() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.addClaim(claim(TOWN_A, 0, 0).withTrust(NOMAD, true), CLAIMED));

    await(store.saveClaim(claim(TOWN_A, 0, 0).withTrust(OTHER_TOWN_OWNER, true)));

    assertThat(load().claims())
        .containsExactly(claim(TOWN_A, 0, 0).withTrust(OTHER_TOWN_OWNER, true));
  }

  @Test
  void removingAClaimOrItsTownRemovesItsTrust() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.addClaim(claim(TOWN_A, 0, 0).withTrust(NOMAD, true), CLAIMED));
    await(store.addClaim(claim(TOWN_A, 1, 0).withTrust(NOMAD, true), CLAIMED));

    await(store.removeClaim(Fixtures.chunk(0, 0)));
    assertThat(trustRows()).isEqualTo(1);

    await(store.deleteTown(TownPayout.of(Fixtures.townA())));
    assertThat(trustRows()).isZero();
  }

  @Test
  void savingATownReplacesItsNameLevelAndMembers() throws Exception {
    await(store.createTown(Fixtures.townA()));
    var handed =
        Fixtures.townA()
            .transferredTo(MEMBER, 2)
            .withoutMember(ASSISTANT)
            .withMember(NOMAD, TownRole.MEMBER)
            .renamed("Arcadia");

    await(store.saveTown(handed));

    assertThat(load().towns()).containsExactly(handed);
  }

  @Test
  void savingATownThatIsNotStoredFails() {
    assertThatThrownBy(() -> await(store.saveTown(Fixtures.townB())))
        .isInstanceOf(ExecutionException.class);
  }

  @Test
  void aSavedTownKeepsNamesAndMembershipsUnique() throws Exception {
    await(store.createTown(Fixtures.townA()));
    await(store.createTown(Fixtures.townB()));

    assertThatThrownBy(() -> await(store.saveTown(Fixtures.townB().renamed("aegis"))))
        .isInstanceOf(ExecutionException.class);
    assertThatThrownBy(
            () -> await(store.saveTown(Fixtures.townB().withMember(MEMBER, TownRole.MEMBER))))
        .isInstanceOf(ExecutionException.class);
    assertThat(load().towns()).containsExactlyInAnyOrder(Fixtures.townA(), Fixtures.townB());
  }

  @Test
  void departureTransfersOnlyLocksWhollyOnItsClaimsAndRemovesNewOwnerTrust() throws Exception {
    var locks = new JooqLocksStore(database);
    await(store.createTown(Fixtures.townA()));
    await(store.createTown(Fixtures.townB()));
    await(store.addClaim(claim(TOWN_A, 0, 0), CLAIMED));
    await(store.addClaim(claim(TOWN_B, 1, 0), CLAIMED));
    var inside =
        new Lock(
            UUID.randomUUID(),
            MEMBER,
            Set.of(new BlockPos("world", 0, 64, 0)),
            Map.of(OWNER, LockGrant.USE),
            new Lock.Options(true, true));
    var split =
        Lock.of(
            UUID.randomUUID(),
            MEMBER,
            Set.of(new BlockPos("world", 15, 64, 0), new BlockPos("world", 16, 64, 0)));
    var foreign = Lock.of(UUID.randomUUID(), MEMBER, Set.of(new BlockPos("world", 17, 64, 0)));
    await(locks.save(inside));
    await(locks.save(split));
    await(locks.save(foreign));

    var updated = Fixtures.townA().withoutMember(MEMBER);
    assertThat(await(store.saveDeparture(updated, MEMBER))).containsExactly(inside.id());

    assertThat(load().towns()).contains(updated);
    assertThat(await(locks.loadAll()))
        .containsExactlyInAnyOrder(inside.ownedBy(OWNER), split, foreign);
  }

  @Test
  void failedLockTransferRollsBackMembership() throws Exception {
    var locks = new JooqLocksStore(database);
    var original = Fixtures.townA();
    await(store.createTown(original));
    await(store.addClaim(claim(TOWN_A, 0, 0), CLAIMED));
    var lock = Lock.of(UUID.randomUUID(), MEMBER, Set.of(new BlockPos("world", 1, 64, 1)));
    await(locks.save(lock));
    await(
        database.write(
            dsl -> {
              dsl.execute(
                  "CREATE TRIGGER fail_lock_transfer BEFORE UPDATE OF owner_id ON towns_lock "
                      + "BEGIN SELECT RAISE(FAIL, 'lock write failed'); END");
              return 0;
            }));

    assertThatThrownBy(() -> await(store.saveDeparture(original.withoutMember(MEMBER), MEMBER)))
        .isInstanceOf(ExecutionException.class);
    assertThat(load().towns()).containsExactly(original);
    assertThat(await(locks.loadAll())).containsExactly(lock);
  }

  private int trustRows() throws Exception {
    return await(database.read(dsl -> dsl.fetchCount(DSL.table("towns_claim_trust"))));
  }

  private int flagRows() throws Exception {
    return await(database.read(dsl -> dsl.fetchCount(DSL.table("towns_claim_flag"))));
  }
}
