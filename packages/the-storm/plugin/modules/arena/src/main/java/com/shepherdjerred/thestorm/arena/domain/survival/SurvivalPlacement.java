package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import com.shepherdjerred.thestorm.arena.domain.geometry.Spot;
import java.util.LinkedHashMap;
import java.util.Map;

/** An authored coordinate frame keeps layouts and surface patterns identical after relocation. */
public record SurvivalPlacement(int x, int z) {
  public static SurvivalPlacement authored(SurvivalContent content) {
    var origin = content.arena().region().min();
    return switch (content.arena().id()) {
      case "settlement" -> new SurvivalPlacement(1712 - origin.x(), 2128 - origin.z());
      case "rustworks" -> new SurvivalPlacement(1920 - origin.x(), 2112 - origin.z());
      default -> throw new IllegalArgumentException("No placement for " + content.arena().id());
    };
  }

  public BlockPos block(BlockPos at) {
    return new BlockPos(at.x() + x, at.y(), at.z() + z);
  }

  private Point point(Point at) {
    return new Point(at.x() + x, at.y(), at.z() + z);
  }

  private Spot spot(Spot at) {
    return new Spot(at.x() + x, at.y(), at.z() + z, at.yaw(), at.pitch());
  }

  private Cuboid cuboid(Cuboid area) {
    return new Cuboid(block(area.min()), block(area.max()));
  }

  public SurvivalContent content(SurvivalContent source) {
    var arena = source.arena();
    var signs = new LinkedHashMap<String, BlockPos>();
    arena.classSigns().forEach((id, at) -> signs.put(id, block(at)));
    var moved =
        new ArenaDefinition(
            arena.id(),
            arena.name(),
            arena.world(),
            cuboid(arena.region()),
            spot(arena.lobby()),
            spot(arena.spectator()),
            spot(arena.exit()),
            arena.playerSpawns().stream().map(this::spot).toList(),
            arena.mobSpawns().stream().map(this::point).toList(),
            signs,
            block(arena.readyBlock()),
            arena.lootChests().stream().map(this::block).toList(),
            arena.joinSigns().stream().map(this::block).toList(),
            arena.tier(),
            arena.minPlayers(),
            arena.maxPlayers());
    var zones =
        source.zones().stream()
            .map(
                zone ->
                    new SurvivalContent.Zone(
                        zone.id(),
                        zone.name(),
                        zone.areas().stream().map(this::cuboid).toList(),
                        zone.emeralds(),
                        zone.requires(),
                        point(zone.entrance()),
                        zone.spawns().stream().map(this::point).toList(),
                        zone.safePoints().stream().map(this::point).toList(),
                        zone.purchaseSigns().stream().map(this::block).toList(),
                        zone.gate().stream().map(this::block).toList(),
                        zone.stations().stream()
                            .map(
                                station ->
                                    new SurvivalContent.Station(
                                        block(station.block()), station.type()))
                            .toList(),
                        zone.resources().stream()
                            .map(
                                resource ->
                                    new SurvivalContent.Resource(
                                        block(resource.block()),
                                        resource.material(),
                                        resource.amount(),
                                        resource.perRound()))
                            .toList(),
                        zone.defenses().stream()
                            .map(
                                defense ->
                                    new SurvivalContent.Defense(
                                        defense.id(), block(defense.block()), defense.type()))
                            .toList()))
            .toList();
    var expedition = source.expedition();
    return new SurvivalContent(
        source.enabled(),
        moved,
        source.entityCap(),
        zones,
        source.recipes(),
        cuboid(source.lobbyArea()),
        new SurvivalContent.Expedition(
            cuboid(expedition.area()),
            point(expedition.arrival()),
            point(expedition.returnTo()),
            block(expedition.returnSign()),
            expedition.spawns().stream().map(this::point).toList(),
            expedition.safePoints().stream().map(this::point).toList()),
        source.machines().stream()
            .map(
                machine ->
                    new SurvivalContent.Machine(
                        block(machine.block()),
                        machine.type(),
                        machine.interactions().stream().map(this::block).toList()))
            .toList(),
        source.planeParts().stream()
            .map(part -> new SurvivalContent.PlanePart(part.id(), part.name(), block(part.block())))
            .toList(),
        block(source.planeWorkbench()),
        block(source.bossObjective()),
        source.routes(),
        source.boxSites().stream()
            .map(
                site ->
                    new SurvivalContent.BoxSite(
                        site.id(), site.zone(), block(site.block()), block(site.beacon())))
            .toList(),
        source.classes(),
        source.legendaries(),
        block(source.lobbyGuide()));
  }

  public Map<BlockPos, String> restore(Map<BlockPos, String> authored) {
    if (x == 0 && z == 0) return java.util.Collections.unmodifiableMap(authored);
    var result = new LinkedHashMap<BlockPos, String>();
    var entries = authored.entrySet().iterator();
    while (entries.hasNext()) {
      var entry = entries.next();
      var at = entry.getKey();
      result.put(new BlockPos(at.x() - x, at.y(), at.z() - z), entry.getValue());
      entries.remove();
    }
    return java.util.Collections.unmodifiableMap(result);
  }
}
