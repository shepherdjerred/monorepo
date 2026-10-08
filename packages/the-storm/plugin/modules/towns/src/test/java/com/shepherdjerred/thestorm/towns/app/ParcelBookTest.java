package com.shepherdjerred.thestorm.towns.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.parcel.Lease;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelDefinition;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelsConfig;
import com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAreas;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import com.shepherdjerred.thestorm.towns.domain.region.RegionSpawns;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import com.shepherdjerred.thestorm.towns.domain.world.WorldRules;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Expiry is enforced by live permission lookups, independently of cleanup and admissions. */
final class ParcelBookTest {
  private static final UUID OWNER = UUID.randomUUID();
  private static final UUID STRANGER = UUID.randomUUID();
  private static final Instant EXPIRY = Instant.parse("2026-10-01T00:00:00Z");
  private static final Cuboid BOX =
      new Cuboid("world", new BlockCorner(1, 66, 1), new BlockCorner(12, 96, 12));
  private static final Act BUILD = new Act(Action.BUILD, Subject.BLOCK);
  private static final Act OPEN = new Act(Action.OPEN_CONTAINER, Subject.CONTAINER);

  @Test
  void restoredShopDistrictContainsEveryReviewedBuildingWithoutInventingOwners() throws Exception {
    var path = Path.of("../../../server/owned/plugins/TheStorm/parcels.yml");
    var config =
        StrictYaml.parse(path.toString(), Files.readString(path), ParcelsConfig.class)
            .fold(
                value -> value,
                errors -> {
                  throw new AssertionError(errors);
                });
    assertThat(config.parcels()).hasSize(20);
    assertThat(
            config.parcels().stream().filter(parcel -> parcel.kind() == ParcelKind.PERMANENT_SHOP))
        .hasSize(19)
        .allSatisfy(parcel -> assertThat(parcel.weeklyRent()).isZero());
    assertThat(config.parcels().stream().filter(parcel -> !parcel.owners().isEmpty())).hasSize(3);
    assertThat(config.parcels().stream().map(ParcelDefinition::id))
        .contains(
            "lawful-farm-shop",
            "mining-building-shop",
            "anteron-zah-shop",
            "level-30-shop",
            "skymart-shop");
    var book = new ParcelBook(config, InstantSource.fixed(EXPIRY));
    var state = new TownsState(new RegionIndex(List.of()));
    state.attachParcels(book);
    for (var point :
        List.of(
            new int[] {10, -142}, new int[] {93, -87}, new int[] {134, -60}, new int[] {68, -39})) {
      var land = state.landAt("world", point[0], 69, point[1]);
      assertThat(land).isInstanceOf(Land.ParcelLand.class);
      assertThat(
              new ProtectionEngine(state, player -> false)
                  .decide(Actor.player(STRANGER), BUILD, land)
                  .isAllowed())
          .isFalse();
    }
  }

  @Test
  void ownerBuildsBeforeExpiryAndOnlyWithdrawsDuringGrace() {
    var def = definition(ParcelKind.RENTAL_SHOP);
    var lease = new Lease(def.id(), OWNER, EXPIRY, Lease.State.HELD);
    for (var now : List.of(EXPIRY.minusMillis(1), EXPIRY, EXPIRY.plus(Lease.GRACE))) {
      var book = new ParcelBook(new ParcelsConfig(List.of(def)), InstantSource.fixed(now));
      book.load(List.of(lease));
      var rights = book.rights(def, RegionProfile.SAFE);
      assertThat(rights.permits(OWNER, BUILD)).isEqualTo(now.isBefore(EXPIRY));
      assertThat(rights.permits(OWNER, OPEN)).isEqualTo(now.isBefore(EXPIRY.plus(Lease.GRACE)));
      assertThat(rights.permits(STRANGER, BUILD)).isFalse();
      assertThat(rights.permits(STRANGER, OPEN)).isFalse();
      assertThat(rights.profile()).isEqualTo(RegionProfile.SAFE);
    }
  }

  @Test
  void renewingAddsToPrepaidTimeAndGraceStartsANewWeek() {
    var lease = new Lease("shop", OWNER, EXPIRY, Lease.State.HELD);
    assertThat(lease.renewed(EXPIRY.minusSeconds(60)).paidThrough())
        .isEqualTo(EXPIRY.plus(Lease.WEEK));
    var late = EXPIRY.plusSeconds(60);
    assertThat(lease.renewed(late).paidThrough()).isEqualTo(late.plus(Lease.WEEK));
    assertThatThrownBy(() -> lease.renewed(EXPIRY.plus(Lease.GRACE)))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void permanentShopOwnershipDoesNotConsumeARentalOrTownMembership() {
    var def = definition(ParcelKind.PERMANENT_SHOP);
    var book = new ParcelBook(new ParcelsConfig(List.of(def)), InstantSource.fixed(EXPIRY));
    var state = new TownsState(new RegionIndex(List.of()));
    state.attachParcels(book);
    assertThat(book.holdsRental(OWNER)).isFalse();
    assertThat(state.townOf(OWNER)).isEmpty();
    assertThat(state.landAt("world", 3, 70, 3)).isInstanceOf(Land.ParcelLand.class);
    assertThat(book.rights(def, RegionProfile.SAFE).permits(OWNER, BUILD)).isTrue();
    assertThat(book.rights(def, RegionProfile.SAFE).permits(STRANGER, BUILD)).isFalse();
  }

  @Test
  void shopOwnerCannotEnablePvpOrBoundaryGriefAndWorkReservationStopsEvenStaff() {
    var def = definition(ParcelKind.PERMANENT_SHOP);
    var book = new ParcelBook(new ParcelsConfig(List.of(def)), InstantSource.fixed(EXPIRY));
    var state = new TownsState(new RegionIndex(List.of()));
    state.attachParcels(book);
    var engine = new ProtectionEngine(state, player -> true);
    var shop = new Land.ParcelLand(book.rights(def, RegionProfile.SAFE));
    assertThat(engine.decide(Actor.player(OWNER), BUILD, shop).isAllowed()).isTrue();
    assertThat(engine.decidePvp(Actor.player(OWNER), STRANGER, shop, shop).isAllowed()).isFalse();
    assertThat(engine.allowsUntracedHarm(shop, shop)).isFalse();
    for (var effect :
        List.of(
            WorldEffect.FIRE_SPREAD,
            WorldEffect.EXPLOSION,
            WorldEffect.PISTON,
            WorldEffect.ITEM_TRANSFER)) {
      assertThat(WorldRules.allows(effect, new Land.Wilderness(), shop)).isFalse();
    }
    var reservation =
        new AdminRegion(
            "placement",
            "Placement",
            new RegionAreas(List.of(), List.of(BOX)),
            List.of(),
            RegionSpawns.unlimited(),
            RegionProfile.PRESERVE);
    state.beginWork(reservation);
    assertThat(
            engine
                .decide(new Actor(OWNER, true), BUILD, state.landAt("world", 3, 70, 3))
                .isAllowed())
        .isFalse();
    assertThat(
            engine
                .decide(
                    Actor.player(OWNER),
                    BUILD,
                    state.landAtExceptWork(
                        "placement",
                        new com.shepherdjerred.thestorm.towns.domain.land.BlockPos(
                            "world", 3, 70, 3)))
                .isAllowed())
        .isTrue();
  }

  @Test
  void busyPlotFreezesExistingOwnersAndOverlappingConfigFails() {
    var def = definition(ParcelKind.PERMANENT_SHOP);
    var book = new ParcelBook(new ParcelsConfig(List.of(def)), InstantSource.fixed(EXPIRY));
    book.begin(def.id());
    assertThat(book.rights(def, RegionProfile.SAFE).phase())
        .isEqualTo(ProtectedParcel.Phase.RESETTING);
    assertThat(book.rights(def, RegionProfile.SAFE).permits(OWNER, OPEN)).isFalse();
    var land = new Land.ParcelLand(book.rights(def, RegionProfile.SAFE));
    var engine = new ProtectionEngine(new TownsState(new RegionIndex(List.of())), player -> true);
    assertThat(engine.decide(new Actor(OWNER, true), BUILD, land).isAllowed()).isFalse();
    assertThat(engine.decide(new Actor(OWNER, true), OPEN, land).isAllowed()).isFalse();
    var duplicate =
        new ParcelDefinition("other", "Other", def.kind(), BOX, def.owners(), "survey", 0);
    assertThatThrownBy(() -> new ParcelsConfig(List.of(def, duplicate)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static ParcelDefinition definition(ParcelKind kind) {
    return new ParcelDefinition(
        "shop",
        "Shop",
        kind,
        BOX,
        kind == ParcelKind.RENTAL_SHOP ? Set.of() : Set.of(OWNER),
        "surveyed plot",
        kind == ParcelKind.RENTAL_SHOP ? 720 : 0);
  }
}
