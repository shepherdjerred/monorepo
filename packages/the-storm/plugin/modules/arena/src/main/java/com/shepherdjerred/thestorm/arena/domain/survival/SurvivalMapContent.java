package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import java.util.List;

/** A separately authored map uses the same explicit equipment and class rules. */
public record SurvivalMapContent(
    boolean enabled,
    ArenaDefinition arena,
    int entityCap,
    List<SurvivalContent.Zone> zones,
    Cuboid lobbyArea,
    SurvivalContent.Expedition expedition,
    List<SurvivalContent.Machine> machines,
    List<SurvivalContent.PlanePart> planeParts,
    BlockPos planeWorkbench,
    BlockPos bossObjective,
    List<SurvivalContent.Route> routes,
    List<SurvivalContent.BoxSite> boxSites,
    BlockPos lobbyGuide) {

  /** Runs the complete survival placement and connectivity validation for this map. */
  public SurvivalContent withRules(SurvivalContent rules) {
    return new SurvivalContent(
        enabled,
        arena,
        entityCap,
        zones,
        rules.recipes(),
        lobbyArea,
        expedition,
        machines,
        planeParts,
        planeWorkbench,
        bossObjective,
        routes,
        boxSites,
        rules.classes(),
        rules.legendaries(),
        lobbyGuide);
  }
}
