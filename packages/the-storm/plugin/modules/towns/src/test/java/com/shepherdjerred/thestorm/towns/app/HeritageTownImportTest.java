package com.shepherdjerred.thestorm.towns.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class HeritageTownImportTest {
  private static final UUID OWNER = UUID.fromString("00000000-0000-4000-8000-000000000001");

  private static HeritageSite site(String id, String name, UUID owner) {
    return new HeritageSite(
        id,
        name,
        HeritageSite.Kind.PLAYER,
        name,
        "map2",
        RegionProfile.SAFE,
        Set.of(new HeritageSite.Chunk(0, 0)),
        List.of(),
        Set.of(),
        List.of(new HeritageSite.Editor(owner, "Owner")),
        "Historical evidence");
  }

  @Test
  void createsStableTownWithOnlyTheEvidencedOwner() {
    var site = site("old-town", "OldTown", OWNER);
    var plan = HeritageTownImport.plan(List.of(site), List.of(), Set.of(), Instant.EPOCH);
    assertThat(plan.conflicts()).isEmpty();
    assertThat(plan.towns())
        .singleElement()
        .satisfies(town -> {
          assertThat(town.id()).isEqualTo(site.activeTownId().orElseThrow());
          assertThat(town.owner()).isEqualTo(OWNER);
          assertThat(town.members()).hasSize(1);
        });
  }

  @Test
  void respectsExistingMembershipNamesAndCompletedImports() {
    var first = site("first", "OldTown", OWNER);
    var occupied = Town.found(UUID.randomUUID(), "Modern", Instant.EPOCH, OWNER);
    assertThat(
            HeritageTownImport.plan(List.of(first), List.of(occupied), Set.of(), Instant.EPOCH)
                .conflicts())
        .containsExactly("first");
    var sameName = Town.found(UUID.randomUUID(), "oldtown", Instant.EPOCH, UUID.randomUUID());
    assertThat(
            HeritageTownImport.plan(List.of(first), List.of(sameName), Set.of(), Instant.EPOCH)
                .conflicts())
        .containsExactly("first");
    assertThat(
            HeritageTownImport.plan(
                    List.of(first),
                    List.of(),
                    Set.of(first.activeTownId().orElseThrow()),
                    Instant.EPOCH)
                .towns())
        .isEmpty();
  }
}
