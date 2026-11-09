package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelDefinition;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind;
import com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAreas;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import com.shepherdjerred.thestorm.towns.domain.region.RegionSpawns;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class HistoricalLiftProtectionTest {
  private static final UUID OWNER = new UUID(0, 1);
  private static final Cuboid AREA =
      new Cuboid("world", new BlockCorner(0, -64, 0), new BlockCorner(4, 319, 4));

  private static Land land(ParcelKind kind, ProtectedParcel.Phase phase) {
    var definition = new ParcelDefinition("shop", "Shop", kind, AREA, Set.of(OWNER), "survey", 0);
    var parcel = new ProtectedParcel(definition, Set.of(OWNER), phase, RegionProfile.SAFE);
    var site =
        new HeritageSite(
            "spawn",
            "Spawn",
            HeritageSite.Kind.SERVER,
            "",
            "world",
            RegionProfile.SAFE,
            Set.of(),
            List.of(AREA),
            Set.of(),
            List.of(),
            "survey");
    return new Land.HeritageLand(site, Set.of(), new Land.ParcelLand(parcel));
  }

  @Test
  void onlyAnActiveProvenShopOwnerAllowsPublicLifts() {
    var active = land(ParcelKind.PERMANENT_SHOP, ProtectedParcel.Phase.ACTIVE);
    assertThat(PaperProtection.publicShopLift(active, OWNER)).isTrue();
    assertThat(PaperProtection.publicShopLift(active, new UUID(0, 2))).isFalse();
    assertThat(
            PaperProtection.publicShopLift(
                land(ParcelKind.PERMANENT_SHOP, ProtectedParcel.Phase.RESETTING), OWNER))
        .isFalse();
    assertThat(
            PaperProtection.publicShopLift(
                land(ParcelKind.HERITAGE, ProtectedParcel.Phase.ACTIVE), OWNER))
        .isFalse();
    assertThat(PaperProtection.publicShopLift(new Land.Wilderness(), OWNER)).isFalse();
  }

  @Test
  void cataloguedServerLiftsStopWhenTheirLandBecomesOwnedOrResetting() {
    var site =
        new HeritageSite(
            "old-village",
            "Old Village",
            HeritageSite.Kind.HERITAGE,
            "",
            "world",
            RegionProfile.SAFE,
            Set.of(),
            List.of(AREA),
            Set.of(),
            List.of(),
            "survey");
    assertThat(PaperProtection.serverHistoricalLiftLand(new Land.Wilderness())).isTrue();
    assertThat(
            PaperProtection.serverHistoricalLiftLand(
                new Land.HeritageLand(site, Set.of(), new Land.Wilderness())))
        .isTrue();
    var owned = (Land.HeritageLand) land(ParcelKind.PERMANENT_SHOP, ProtectedParcel.Phase.ACTIVE);
    assertThat(
            PaperProtection.serverHistoricalLiftLand(
                new Land.HeritageLand(site, Set.of(), owned.underlying())))
        .isFalse();
    var resetting =
        (Land.HeritageLand) land(ParcelKind.PERMANENT_SHOP, ProtectedParcel.Phase.RESETTING);
    assertThat(
            PaperProtection.serverHistoricalLiftLand(
                new Land.HeritageLand(site, Set.of(), resetting.underlying())))
        .isFalse();
    var edited =
        new HeritageSite(
            "old-village",
            "Old Village",
            HeritageSite.Kind.HERITAGE,
            "",
            "world",
            RegionProfile.SAFE,
            Set.of(),
            List.of(AREA),
            Set.of(),
            List.of(new HeritageSite.Editor(OWNER, "Owner")),
            "survey");
    assertThat(
            PaperProtection.serverHistoricalLiftLand(
                new Land.HeritageLand(edited, Set.of(OWNER), new Land.Wilderness())))
        .isFalse();

    assertThat(
            PaperProtection.serverHistoricalCircuitLand(
                new Land.HeritageLand(site, Set.of(), new Land.Wilderness())))
        .isTrue();
    assertThat(PaperProtection.serverHistoricalCircuitLand(new Land.Wilderness())).isFalse();
    assertThat(PaperProtection.serverHistoricalCircuitLand(owned)).isFalse();
    assertThat(PaperProtection.serverHistoricalCircuitLand(resetting)).isFalse();
    assertThat(
            PaperProtection.serverHistoricalCircuitLand(
                new Land.HeritageLand(site, Set.of(), new Land.WorkLand(site.asRegion()))))
        .isFalse();
    assertThat(
            PaperProtection.serverHistoricalCircuitLand(
                new Land.HeritageLand(edited, Set.of(OWNER), new Land.Wilderness())))
        .isFalse();
    assertThat(
            PaperProtection.serverHistoricalCircuitLand(
                new Land.HeritageLand(site, Set.of(OWNER), new Land.Wilderness())))
        .isFalse();
  }

  @Test
  void serverLiftsRespectSpawnAndStaffCustody() {
    var parcel = (Land.HeritageLand) land(ParcelKind.PERMANENT_SHOP, ProtectedParcel.Phase.ACTIVE);
    var site = parcel.site();
    var area = new RegionAreas(List.of(), List.of(AREA));
    var spawn =
        new AdminRegion(
            "spawn", "Spawn", area, List.of(), RegionSpawns.unlimited(), RegionProfile.SAFE);
    var other =
        new AdminRegion(
            "other", "Other", area, List.of(), RegionSpawns.unlimited(), RegionProfile.SAFE);
    assertThat(
            PaperProtection.serverSpawnLift(
                new Land.HeritageLand(site, Set.of(), new Land.Wilderness())))
        .isTrue();
    assertThat(
            PaperProtection.serverSpawnLift(
                new Land.HeritageLand(site, Set.of(), new Land.RegionLand(spawn))))
        .isTrue();
    assertThat(
            PaperProtection.serverSpawnLift(
                new Land.HeritageLand(site, Set.of(), new Land.RegionLand(other))))
        .isFalse();
    assertThat(PaperProtection.serverSpawnLift(parcel)).isFalse();
    var shop = ((Land.ParcelLand) parcel.underlying()).parcel();
    var staffShop =
        new ProtectedParcel(
            shop.definition(), Set.of(), ProtectedParcel.Phase.ACTIVE, RegionProfile.SAFE);
    assertThat(
            PaperProtection.serverSpawnLift(
                new Land.HeritageLand(site, Set.of(), new Land.ParcelLand(staffShop))))
        .isTrue();
    var resetting =
        new ProtectedParcel(
            shop.definition(), Set.of(), ProtectedParcel.Phase.RESETTING, RegionProfile.SAFE);
    assertThat(
            PaperProtection.serverSpawnLift(
                new Land.HeritageLand(site, Set.of(), new Land.ParcelLand(resetting))))
        .isFalse();
    assertThat(PaperProtection.serverSpawnLift(new Land.Wilderness())).isFalse();
  }
}
