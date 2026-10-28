package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.LayeredLandscape;
import com.shepherdjerred.thestorm.skylands.domain.LayeredSites;
import com.shepherdjerred.thestorm.skylands.domain.SkyPlan;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import com.shepherdjerred.thestorm.skylands.domain.SkyRandom;
import java.util.Random;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.CreatureSpawner;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Villager;
import org.bukkit.entity.minecart.StorageMinecart;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.generator.BlockPopulator;
import org.bukkit.generator.LimitedRegion;
import org.bukkit.generator.WorldInfo;
import org.bukkit.loot.LootTables;

/** Normal world population, with immutable plans and chunk-local writes; no deferred pastes. */
final class LayeredPopulation extends BlockPopulator {
  private final LayeredLandscape landscape;
  private final LayeredSites sites;
  private final SkyPosition spawn;
  private final LayeredBlocks blocks = new LayeredBlocks();
  private final LayeredFluids fluids;
  private final LayeredVegetation vegetation;
  private final LayeredPiecePlacement pieces;
  private final LayeredAnimals animals;
  private final LayeredFlora flora;

  LayeredPopulation(
      LayeredLandscape landscape,
      LayeredSites sites,
      NativeSkyTemplates templates,
      SkyPosition spawn) {
    this.landscape = landscape;
    this.sites = sites;
    this.spawn = spawn;
    fluids = new LayeredFluids(landscape, blocks);
    vegetation = new LayeredVegetation(blocks);
    pieces = new LayeredPiecePlacement(templates, blocks, landscape.seed());
    animals = new LayeredAnimals(landscape);
    flora = new LayeredFlora(landscape, blocks);
  }

  @Override
  public void populate(WorldInfo info, Random random, int x, int z, LimitedRegion region) {
    var slice = new LayeredSlice(x, z, region, sites.forChunk(x, z));
    fluids.populate(slice);
    if (sites.protectsChunk(x, z)) flora.populate(slice, spawn);
    vegetation.clear(slice, spawn);
    edits(slice, SkyPlan.Phase.FOUNDATION);
    pieces.place(slice);
    edits(slice, SkyPlan.Phase.DETAIL);
    ruinBiomes(slice);
    residents(slice);
    animals.populate(slice);
  }

  private static void ruinBiomes(LayeredSlice slice) {
    if (slice.plan().kind()
        != com.shepherdjerred.thestorm.skylands.domain.SkyCell.Kind.ANCIENT_CITY) return;
    for (var piece : slice.plan().pieces()) paint(slice, piece.bounds().expanded(5));
    for (var edit : slice.plan().edits()) {
      if (edit.block().startsWith("minecraft:sculk_shrieker")) {
        paint(
            slice,
            new com.shepherdjerred.thestorm.skylands.domain.SkyBounds(
                    edit.position(), edit.position())
                .expanded(7));
      }
    }
  }

  private static void paint(
      LayeredSlice slice, com.shepherdjerred.thestorm.skylands.domain.SkyBounds bounds) {
    for (var x = slice.x() * 16; x < slice.x() * 16 + 16; x += 4) {
      for (var z = slice.z() * 16; z < slice.z() * 16 + 16; z += 4) {
        for (var y = Math.floorDiv(Math.max(-64, bounds.min().y()), 4) * 4;
            y <= Math.min(319, bounds.max().y());
            y += 4) {
          if (bounds.contains(new SkyPosition(x, y, z)))
            slice.region().setBiome(x, y, z, org.bukkit.block.Biome.DEEP_DARK);
        }
      }
    }
  }

  private void edits(LayeredSlice slice, SkyPlan.Phase phase) {
    for (var edit : slice.plan().edits()) {
      var p = edit.position();
      if (edit.phase() != phase || !slice.owns(p)) continue;
      var data = blocks.get(edit.block());
      slice.region().setBlockData(p.x(), p.y(), p.z(), data);
      if (data.getMaterial() == Material.SPAWNER) {
        var state = (CreatureSpawner) slice.region().getBlockState(p.x(), p.y(), p.z());
        state.setSpawnedType(EntityType.CAVE_SPIDER);
        slice.region().setBlockState(p.x(), p.y(), p.z(), state);
      }
    }
  }

  private void residents(LayeredSlice slice) {
    for (var resident : slice.plan().residents()) {
      var p = resident.position();
      if (!slice.owns(p)) continue;
      var location = new Location(slice.region().getWorld(), p.x() + .5, p.y() + .1, p.z() + .5);
      switch (resident.kind()) {
        case VILLAGER ->
            slice
                .region()
                .spawn(
                    location,
                    Villager.class,
                    SpawnReason.CUSTOM,
                    v -> {
                      v.setVillagerType(villagerType(slice, p));
                      if (Math.floorMod(SkyRandom.hash(p, landscape.seed() + 2879), 7) == 0)
                        v.setBaby();
                      v.setRemoveWhenFarAway(false);
                    });
        case LOOT_MINECART ->
            slice
                .region()
                .spawn(
                    location,
                    StorageMinecart.class,
                    SpawnReason.CUSTOM,
                    cart -> {
                      cart.setLootTable(LootTables.ABANDONED_MINESHAFT.getLootTable());
                      cart.setSeed(SkyRandom.hash(p, landscape.seed() + 2267));
                    });
        case IRON_GOLEM, CAT, COW, SHEEP, HORSE ->
            slice
                .region()
                .spawnEntity(
                    location,
                    EntityType.valueOf(resident.kind().name()),
                    SpawnReason.CUSTOM,
                    entity -> entity.setPersistent(true));
      }
    }
  }

  private static Villager.Type villagerType(LayeredSlice slice, SkyPosition p) {
    var key =
        slice.plan().pieces().stream()
            .filter(piece -> piece.bounds().contains(p))
            .findFirst()
            .orElseThrow()
            .template()
            .key()
            .split("/", -1)[1];
    return switch (key) {
      case "plains" -> Villager.Type.PLAINS;
      case "desert" -> Villager.Type.DESERT;
      case "savanna" -> Villager.Type.SAVANNA;
      case "snowy" -> Villager.Type.SNOW;
      case "taiga" -> Villager.Type.TAIGA;
      default -> throw new IllegalArgumentException("Unknown native village family " + key);
    };
  }
}
