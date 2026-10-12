package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.chunk;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimAllowance;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimLimits;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimPolicy;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageIndex;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.map.Outline;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import com.shepherdjerred.thestorm.towns.domain.town.MembershipPolicy;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The web map follows claims, unclaims, renames, deletes and reloads. */
final class MapSyncTest {

  private final FakeTownsStore store = new FakeTownsStore();
  private final TownsState state = new TownsState(new RegionIndex(List.of()));
  private final FakeMap map = new FakeMap();
  private final MapSync sync = new MapSync(state, map);
  private final Settling settling =
      new Settling(
          state,
          store,
          new Clocks(
              InstantSource.fixed(Instant.parse("2026-09-25T12:00:00Z")),
              new SplittableRandom(1),
              Runnable::run,
              failure -> {}),
          sync);
  private final TownService towns =
      new TownService(
          settling,
          new Claiming(
              new ClaimPolicy(
                  Set.of(Fixtures.WORLD),
                  2,
                  new ClaimAllowance(10, List.of(1, 2, 3, 4, 5)),
                  Set.of())),
          player -> OptionalInt.empty());
  private final MembershipService members =
      new MembershipService(
          settling,
          new MembershipPolicy(60, 30),
          new MembershipService.Hooks(
              player -> OptionalInt.empty(),
              ClaimLimits.flat(10),
              MembershipService.Departures.NONE));

  @BeforeEach
  void load() {
    store.seed(Fixtures.townA(), claim(TOWN_A, 0, 0));
    store.seed(Fixtures.townB(), claim(TOWN_B, 20, 20));
    state.load(store.snapshot());
    sync.redrawAll();
  }

  @Test
  void everyTownIsDrawnWhenTheMapStarts() {
    assertThat(map.drawn.keySet()).containsExactlyInAnyOrder(TOWN_A, TOWN_B);
    assertThat(map.names).containsEntry(TOWN_A, "Aegis");
    assertThat(pieces(TOWN_A)).hasSize(1);
  }

  @Test
  void aClaimRedrawsItsTownAsOnePiece() {
    var _ = towns.claim(OWNER, chunk(1, 0));
    store.succeed();

    var outline = pieces(TOWN_A).getFirst();
    assertThat(outline.ring())
        .containsExactly(
            new Outline.Corner(0, 0),
            new Outline.Corner(32, 0),
            new Outline.Corner(32, 16),
            new Outline.Corner(0, 16));
  }

  @Test
  void theLastUnclaimErasesTheTown() {
    var _ = towns.unclaim(OWNER, chunk(0, 0));
    store.succeed();

    assertThat(map.drawn).doesNotContainKey(TOWN_A);
  }

  @Test
  void aRenameRelabels() {
    var _ = members.rename(OWNER, "Arcadia");
    store.succeed();

    assertThat(map.names).containsEntry(TOWN_A, "Arcadia");
  }

  @Test
  void aDeletedTownIsErased() {
    var _ = towns.disband(OWNER, "Aegis");
    store.succeed();

    assertThat(map.drawn).doesNotContainKey(TOWN_A);
    assertThat(map.drawn).containsKey(TOWN_B);
  }

  @Test
  void aFailedSaveRedrawsEverythingFromStorage() {
    var _ = towns.claim(OWNER, chunk(1, 0));
    map.erasedAll = 0;

    store.fail();

    assertThat(map.erasedAll).isEqualTo(1);
    assertThat(pieces(TOWN_A).getFirst().ring()).hasSize(4);
    assertThat(pieces(TOWN_A).getFirst().ring()).contains(new Outline.Corner(16, 16));
  }

  @Test
  void preservedCuboidsUseExactBlockEdgesRatherThanExpandedChunks() {
    var site =
        heritage(
            Set.of(),
            new Cuboid("world", new BlockCorner(164, -64, -40), new BlockCorner(290, 319, 46)));
    state.attachHeritage(new HeritageIndex(List.of(site)));
    sync.redrawAll();

    assertThat(pieces(heritageId()).getFirst().ring())
        .containsExactly(
            new Outline.Corner(164, -40),
            new Outline.Corner(291, -40),
            new Outline.Corner(291, 47),
            new Outline.Corner(164, 47));
    assertThat(site.contains(163, 64, 0)).isFalse();
    assertThat(site.contains(291, 64, 0)).isFalse();
  }

  @Test
  void explicitProtectedChunksAndNegativeCuboidsKeepTheirSeparateExactEdges() {
    var site =
        heritage(
            Set.of(new HeritageSite.Chunk(-2, -3)),
            new Cuboid("world", new BlockCorner(-13, -64, 6), new BlockCorner(-3, 319, 8)));
    state.attachHeritage(new HeritageIndex(List.of(site)));
    sync.redrawAll();

    assertThat(pieces(heritageId())).hasSize(2);
    assertThat(pieces(heritageId()).getFirst().ring())
        .containsExactly(
            new Outline.Corner(-32, -48),
            new Outline.Corner(-16, -48),
            new Outline.Corner(-16, -32),
            new Outline.Corner(-32, -32));
    assertThat(pieces(heritageId()).getLast().ring())
        .containsExactly(
            new Outline.Corner(-13, 6),
            new Outline.Corner(-2, 6),
            new Outline.Corner(-2, 9),
            new Outline.Corner(-13, 9));
    assertThat(site.contains(-16, 64, 7)).isFalse();
    assertThat(site.contains(-4, 64, 7)).isTrue();
  }

  private static HeritageSite heritage(Set<HeritageSite.Chunk> chunks, Cuboid area) {
    return new HeritageSite(
        "exact",
        "Exact heritage",
        HeritageSite.Kind.SERVER,
        "",
        "world",
        RegionProfile.PRESERVE,
        chunks,
        List.of(area),
        Set.of(),
        List.of(),
        "Native test footprint");
  }

  private static UUID heritageId() {
    return UUID.nameUUIDFromBytes("heritage:exact".getBytes(StandardCharsets.UTF_8));
  }

  private List<Outline> pieces(UUID town) {
    return requireNonNull(requireNonNull(map.drawn.get(town)).get("world"));
  }

  /** Remembers what it shows. */
  private static final class FakeMap implements TownMap {

    final Map<UUID, Map<String, List<Outline>>> drawn = new LinkedHashMap<>();
    final Map<UUID, String> names = new LinkedHashMap<>();
    final List<UUID> erased = new ArrayList<>();
    int erasedAll;

    @Override
    public void draw(UUID townId, String name, Map<String, List<Outline>> outlines) {
      drawn.put(townId, outlines);
      names.put(townId, name);
    }

    @Override
    public void erase(UUID townId) {
      drawn.remove(townId);
      erased.add(townId);
    }

    @Override
    public void eraseAll() {
      drawn.clear();
      erasedAll++;
    }
  }
}
