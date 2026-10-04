package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.util.Map;

/** Configured interaction fixtures and collision-free arrival pads. */
final class SettlementFixtures {
  private final SurvivalContent content;
  private final Map<BlockPos, String> blocks;

  SettlementFixtures(SurvivalContent content, Map<BlockPos, String> blocks) {
    this.content = content;
    this.blocks = blocks;
  }

  void apply() {
    content.zones().forEach(this::zoneFixtures);
    content.arena().classSigns().values().forEach(p -> fixture(p, "OAK_SIGN"));
    fixture(content.arena().readyBlock(), "IRON_BLOCK");
    fixture(content.lobbyGuide(), "LECTERN");
    content.machines().forEach(this::machine);
    content.boxSites().forEach(this::mysterySite);
    content.planeParts().forEach(p -> fixture(p.block(), "OAK_SIGN"));
    fixture(content.planeWorkbench(), "OAK_SIGN");
    fixture(content.bossObjective(), "AMETHYST_BLOCK");
    fixture(content.expedition().returnSign(), "OAK_SIGN");
    content.arena().playerSpawns().forEach(p -> landing(p.point().block()));
    content.expedition().spawns().forEach(p -> landing(p.block()));
    content.expedition().safePoints().forEach(p -> landing(p.block()));
    landing(content.arena().lobby().point().block());
    landing(content.arena().spectator().point().block());
    landing(content.expedition().arrival().block());
    landing(content.expedition().returnTo().block());
  }

  private void machine(SurvivalContent.Machine machine) {
    var type =
        switch (machine.type()) {
          case FOOD -> "BARREL";
          case POWER -> "LODESTONE";
          case MYSTERY_BOX -> "CHEST";
          case PACK_A_PUNCH -> "ANVIL";
          case JUGGERNOG, STAMIN_UP, DOUBLE_TAP, QUICK_REVIVE -> "JUKEBOX";
        };
    fixture(machine.block(), type);
    var color =
        switch (machine.type()) {
          case JUGGERNOG -> "RED_CONCRETE";
          case STAMIN_UP -> "LIME_CONCRETE";
          case DOUBLE_TAP -> "ORANGE_CONCRETE";
          case QUICK_REVIVE -> "CYAN_CONCRETE";
          case FOOD -> "BARREL";
          case POWER -> "COPPER_BLOCK";
          case PACK_A_PUNCH -> "SMITHING_TABLE";
          case MYSTERY_BOX -> "CHEST";
        };
    machine.interactions().forEach(p -> absolute(p.x(), p.y(), p.z(), color));
  }

  private void mysterySite(SurvivalContent.BoxSite site) {
    fixture(site.block(), "CHEST");
    var beam = site.beacon();
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++)
        absolute(beam.x() + dx, beam.y() - 1, beam.z() + dz, "IRON_BLOCK");
    absolute(beam.x(), beam.y(), beam.z(), "AIR");
    absolute(beam.x(), beam.y() + 1, beam.z(), "MAGENTA_STAINED_GLASS");
    for (var y = beam.y() + 2; y <= content.arena().region().max().y(); y++)
      absolute(beam.x(), y, beam.z(), "AIR");
  }

  private void zoneFixtures(SurvivalContent.Zone zone) {
    landing(zone.entrance().block());
    zone.gate()
        .forEach(p -> absolute(p.x(), p.y(), p.z(), zone.emeralds() == 0 ? "AIR" : "IRON_BARS"));
    zone.purchaseSigns().forEach(p -> fixture(p, "OAK_SIGN"));
    zone.stations()
        .forEach(
            s ->
                fixture(
                    s.block(),
                    switch (s.type()) {
                      case WORKBENCH -> "CRAFTING_TABLE";
                      case FORGE -> "SMITHING_TABLE";
                      case INFIRMARY -> "CAULDRON";
                      case ALCHEMY -> "ENCHANTING_TABLE";
                      case BANK -> "ENDER_CHEST";
                    }));
    zone.resources().forEach(r -> fixture(r.block(), ResourceKind.valueOf(r.material()).fixture()));
    zone.defenses()
        .forEach(
            d ->
                fixture(
                    d.block(),
                    d.type() == SurvivalContent.DefenseType.BARRICADE
                        ? "OAK_FENCE"
                        : "STONE_PRESSURE_PLATE"));
    for (var spawn : zone.spawns()) landing(spawn.block());
    for (var safe : zone.safePoints()) landing(safe.block());
  }

  private void fixture(BlockPos pos, String type) {
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) {
        absolute(pos.x() + dx, pos.y() - 1, pos.z() + dz, "STONE_BRICKS");
        for (var dy = 0; dy <= 2; dy++) absolute(pos.x() + dx, pos.y() + dy, pos.z() + dz, "AIR");
      }
    absolute(pos.x(), pos.y(), pos.z(), type);
  }

  private void landing(BlockPos pos) {
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) {
        absolute(pos.x() + dx, pos.y() - 1, pos.z() + dz, "STONE_BRICKS");
        for (var dy = 0; dy <= 2; dy++) absolute(pos.x() + dx, pos.y() + dy, pos.z() + dz, "AIR");
      }
  }

  private void absolute(int x, int y, int z, String material) {
    var pos = new BlockPos(x, y, z);
    if (!content.arena().region().contains(pos))
      throw new IllegalArgumentException("Fixture exceeds protected footprint: " + pos);
    blocks.put(pos, material);
  }
}
