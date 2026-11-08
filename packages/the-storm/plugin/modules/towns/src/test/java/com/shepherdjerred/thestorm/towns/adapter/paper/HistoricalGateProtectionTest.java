package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelDefinition;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind;
import com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class HistoricalGateProtectionTest {
  @Test
  void approvedArchiveGatesOperateInHistoricalHoldingsButStopAtRecoveryBoundaries() {
    var area = new Cuboid("world", new BlockCorner(0, -64, 0), new BlockCorner(4, 319, 4));
    var site =
        new HeritageSite(
            "old-village",
            "Old Village",
            HeritageSite.Kind.HERITAGE,
            "",
            "world",
            RegionProfile.SAFE,
            Set.of(),
            List.of(area),
            Set.of(),
            List.of(),
            "survey");
    assertThat(
            PaperProtection.serverHistoricalGateLand(
                new Land.HeritageLand(site, Set.of(), new Land.Wilderness())))
        .isTrue();
    assertThat(PaperProtection.serverHistoricalGateLand(new Land.Wilderness())).isFalse();
    var owner = UUID.randomUUID();
    var parcel =
        new ParcelDefinition(
            "holding", "Holding", ParcelKind.HERITAGE, area, Set.of(owner), "survey", 0);
    for (var phase : ProtectedParcel.Phase.values()) {
      var holding = new ProtectedParcel(parcel, Set.of(owner), phase, RegionProfile.SAFE);
      assertThat(
              PaperProtection.serverHistoricalGateLand(
                  new Land.HeritageLand(site, Set.of(), new Land.ParcelLand(holding))))
          .isEqualTo(phase == ProtectedParcel.Phase.ACTIVE);
    }
    var rental =
        new ParcelDefinition(
            "rental", "Rental", ParcelKind.RENTAL_SHOP, area, Set.of(), "survey", 10);
    var leased =
        new ProtectedParcel(
            rental, Set.of(owner), ProtectedParcel.Phase.ACTIVE, RegionProfile.SAFE);
    assertThat(
            PaperProtection.serverHistoricalGateLand(
                new Land.HeritageLand(site, Set.of(), new Land.ParcelLand(leased))))
        .isFalse();
    assertThat(
            PaperProtection.serverHistoricalGateLand(
                new Land.HeritageLand(site, Set.of(), new Land.WorkLand(site.asRegion()))))
        .isFalse();
  }
}
