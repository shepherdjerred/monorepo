package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.map.ClaimOutlines;
import com.shepherdjerred.thestorm.towns.domain.map.Outline;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Keeps a {@link TownMap} showing every town's land: redraws a town when its claims or name change,
 * erases it when it is deleted, and redraws everything after a reload or when the map starts. Main
 * thread only.
 */
public final class MapSync implements TownEvents {

  private final TownsState state;
  private final TownMap map;

  public MapSync(TownsState state, TownMap map) {
    this.state = state;
    this.map = map;
  }

  @Override
  public void landChanged(UUID townId) {
    var town = state.town(townId);
    if (town.isEmpty()) {
      map.erase(townId);
      return;
    }
    var chunks = state.claimsOf(townId).stream().map(Claim::chunk).toList();
    if (chunks.isEmpty()) {
      map.erase(townId);
      return;
    }
    map.draw(townId, town.get().name(), ClaimOutlines.of(chunks));
  }

  @Override
  public void removed(UUID townId) {
    map.erase(townId);
  }

  @Override
  public void reloaded() {
    redrawAll();
  }

  /** Clears the map and draws every town again. */
  public void redrawAll() {
    map.eraseAll();
    state.towns().forEach(town -> landChanged(town.id()));
    state
        .heritage()
        .sites()
        .forEach(
            site ->
                map.draw(
                    UUID.nameUUIDFromBytes(
                        ("heritage:" + site.id())
                            .getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                    site.name() + " (" + site.kind() + "; permanently protected)",
                    heritageOutlines(site)));
    state
        .parcels()
        .ifPresent(
            book ->
                book.definitions()
                    .forEach(
                        def -> {
                          var area = def.area();
                          map.draw(
                              UUID.nameUUIDFromBytes(
                                  ("holding:" + def.id())
                                      .getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                              def.name() + " (" + def.kind() + ")",
                              Map.of(area.world(), List.of(outline(area))));
                        }));
  }

  private static Map<String, List<Outline>> heritageOutlines(HeritageSite site) {
    var chunks =
        site.protectedChunks().stream()
            .map(chunk -> new ChunkPos(site.world(), chunk.x(), chunk.z()))
            .toList();
    var outlines = new ArrayList<>(ClaimOutlines.of(chunks).getOrDefault(site.world(), List.of()));
    site.protectedAreas().forEach(area -> outlines.add(outline(area)));
    return Map.of(site.world(), List.copyOf(outlines));
  }

  private static Outline outline(Cuboid area) {
    return new Outline(
        List.of(
            new Outline.Corner(area.from().x(), area.from().z()),
            new Outline.Corner(area.to().x() + 1, area.from().z()),
            new Outline.Corner(area.to().x() + 1, area.to().z() + 1),
            new Outline.Corner(area.from().x(), area.to().z() + 1)),
        List.of());
  }
}
