package com.shepherdjerred.thestorm.towns.domain.heritage;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.FOUNDED;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OTHER_TOWN_OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.townB;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownDirectory;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class HeritageActivationsTest {

  private static HeritageSite town(String id, String name, UUID mayor) {
    var chunk = new HeritageSite.Chunk(0, 0);
    return new HeritageSite(
        id,
        name,
        HeritageSite.Kind.PLAYER,
        name,
        "map2",
        RegionProfile.SAFE,
        Set.of(chunk),
        List.of(),
        Set.of(chunk),
        List.of(new HeritageSite.Editor(mayor, "Mayor " + id)),
        "Signed by its mayor");
  }

  private static HeritageSite heritage(String id) {
    return new HeritageSite(
        id,
        "Old ruin",
        HeritageSite.Kind.HERITAGE,
        "",
        "map2",
        RegionProfile.SAFE,
        Set.of(new HeritageSite.Chunk(1, 1)),
        List.of(),
        Set.of(),
        List.of(),
        "Unowned");
  }

  private static TownDirectory directory(List<Town> towns) {
    return new TownDirectory() {
      @Override
      public Optional<Town> townOf(UUID player) {
        return towns.stream().filter(town -> town.members().containsKey(player)).findFirst();
      }

      @Override
      public Optional<Town> named(String name) {
        return towns.stream().filter(town -> town.name().equalsIgnoreCase(name)).findFirst();
      }
    };
  }

  @Test
  void aMissingTownIsFoundedForItsMayorUnderTheSitesStableId() {
    var site = town("map2-karthil", "Karthil", NOMAD);
    var steps =
        HeritageActivations.plan(
            List.of(site),
            new HeritageActivations.Stored(Set.of(), id -> false),
            directory(List.of()),
            FOUNDED);
    assertThat(steps).hasSize(1);
    var found = (HeritageActivations.Step.Found) steps.getFirst();
    assertThat(found.siteId()).isEqualTo("map2-karthil");
    assertThat(found.town().id()).isEqualTo(site.activeTownId().orElseThrow());
    assertThat(found.town().name()).isEqualTo("Karthil");
    assertThat(found.town().members()).isEqualTo(Map.of(NOMAD, TownRole.OWNER));
    assertThat(found.town().createdAt()).isEqualTo(FOUNDED);
  }

  @Test
  void anImportedTownIsRecordedWithoutFoundingItAgain() {
    var site = town("heritage-000", "Starvationville", NOMAD);
    var id = site.activeTownId().orElseThrow();
    var steps =
        HeritageActivations.plan(
            List.of(site),
            new HeritageActivations.Stored(Set.of(), id::equals),
            directory(List.of()),
            FOUNDED);
    assertThat(steps).containsExactly(new HeritageActivations.Step.Existing("heritage-000", id));
  }

  @Test
  void recordedAndNonPlayerSitesAreLeftAlone() {
    var steps =
        HeritageActivations.plan(
            List.of(town("map2-orcale", "Orcale", NOMAD), heritage("map2-ruin")),
            new HeritageActivations.Stored(Set.of("map2-orcale"), id -> false),
            directory(List.of()),
            FOUNDED);
    assertThat(steps).isEmpty();
  }

  @Test
  void aMayorInAnotherTownOrATakenNameWaitsForALaterStart() {
    var busy = town("map2-eclipse", "Eclipse", OTHER_TOWN_OWNER);
    var taken = town("map2-bastion", "Bastion", NOMAD);
    var steps =
        HeritageActivations.plan(
            List.of(busy, taken),
            new HeritageActivations.Stored(Set.of(), id -> false),
            directory(List.of(townB())),
            FOUNDED);
    assertThat(steps)
        .containsExactly(
            new HeritageActivations.Step.Wait(
                "map2-eclipse", "Mayor map2-eclipse already belongs to Bastion"),
            new HeritageActivations.Step.Wait("map2-bastion", "the name Bastion is taken"));
  }
}
