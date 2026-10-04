package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.map.ClaimOutlines;
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
        .parcels()
        .ifPresent(
            book ->
                book.definitions()
                    .forEach(
                        def -> {
                          var area = def.area();
                          var outline =
                              new com.shepherdjerred.thestorm.towns.domain.map.Outline(
                                  java.util.List.of(
                                      new com.shepherdjerred.thestorm.towns.domain.map.Outline
                                          .Corner(area.from().x(), area.from().z()),
                                      new com.shepherdjerred.thestorm.towns.domain.map.Outline
                                          .Corner(area.to().x() + 1, area.from().z()),
                                      new com.shepherdjerred.thestorm.towns.domain.map.Outline
                                          .Corner(area.to().x() + 1, area.to().z() + 1),
                                      new com.shepherdjerred.thestorm.towns.domain.map.Outline
                                          .Corner(area.from().x(), area.to().z() + 1)),
                                  java.util.List.of());
                          map.draw(
                              UUID.nameUUIDFromBytes(
                                  ("holding:" + def.id())
                                      .getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                              def.name() + " (" + def.kind() + ")",
                              java.util.Map.of(area.world(), java.util.List.of(outline)));
                        }));
  }
}
