package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.IslandChunk;
import com.shepherdjerred.thestorm.skylands.domain.SkyOres;
import com.shepherdjerred.thestorm.skylands.domain.SkyTerrain;
import com.shepherdjerred.thestorm.skylands.domain.SpawnColumn;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.bukkit.HeightMap;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Biome;
import org.bukkit.block.data.BlockData;
import org.bukkit.generator.BiomeProvider;
import org.bukkit.generator.BlockPopulator;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.generator.WorldInfo;

/**
 * Writes Skylands stone and leaves everything else to vanilla: surface rules, carvers, features,
 * structures and initial mobs all run over the islands. There is no vanilla noise, so the world
 * below and between islands is void; the bedrock floor surface rule finds no stone to replace.
 *
 * <p>Paper calls this from parallel world generation threads. The generator holds only immutable
 * state; {@link SkyTerrain} allocates its buffers per call.
 */
public final class SkylandsGenerator extends ChunkGenerator {

  private final SkyTerrain terrain;
  private final int verticalOffset;
  private final Map<Biome, Biome> biomeRemap;
  private final SpawnColumn spawn;
  private final SkyOres ores;
  private final List<BlockData> oreBlocks;

  /**
   * Where the terrain sits in the world.
   *
   * @param verticalOffset the world y of Beta terrain y 0
   * @param spawn the column the world spawn is placed on
   */
  public record Placement(int verticalOffset, SpawnColumn spawn) {}

  /**
   * The deep ores the islands carry.
   *
   * @param plan where veins go
   * @param blocks the block each of the plan's veins places, in order
   */
  public record Ores(SkyOres plan, List<BlockData> blocks) {

    public Ores {
      blocks = List.copyOf(blocks);
    }
  }

  /**
   * @param terrain the island shape for the world seed
   * @param placement the terrain's world y and spawn column
   * @param biomeRemap water-only vanilla biomes to the land biomes generated instead
   * @param ores the deep ores
   */
  public SkylandsGenerator(
      SkyTerrain terrain, Placement placement, Map<Biome, Biome> biomeRemap, Ores ores) {
    this.terrain = terrain;
    this.verticalOffset = placement.verticalOffset();
    this.biomeRemap = Map.copyOf(biomeRemap);
    this.spawn = placement.spawn();
    this.ores = ores.plan();
    this.oreBlocks = ores.blocks();
  }

  @Override
  public void generateNoise(
      WorldInfo worldInfo, Random random, int chunkX, int chunkZ, ChunkData chunkData) {
    var chunk = terrain.chunk(chunkX, chunkZ);
    for (var x = 0; x < 16; x++) {
      for (var z = 0; z < 16; z++) {
        fillColumn(chunk, chunkData, x, z);
      }
    }
    for (var ore : ores.plan(chunkX, chunkZ, chunk)) {
      chunkData.setBlock(ore.x(), ore.y() + verticalOffset, ore.z(), oreBlocks.get(ore.vein()));
    }
  }

  /** Sets each vertical run of island stone in one column with a single region write. */
  private void fillColumn(IslandChunk chunk, ChunkData chunkData, int x, int z) {
    var runStart = -1;
    for (var y = 0; y <= SkyTerrain.HEIGHT; y++) {
      var solid = y < SkyTerrain.HEIGHT && chunk.solid(x, y, z);
      if (solid && runStart < 0) {
        runStart = y;
      } else if (!solid && runStart >= 0) {
        chunkData.setRegion(
            x, runStart + verticalOffset, z, x + 1, y + verticalOffset, z + 1, Material.STONE);
        runStart = -1;
      }
    }
  }

  /** The first free y above the islands, or the world floor over the void. */
  @Override
  public int getBaseHeight(WorldInfo worldInfo, Random random, int x, int z, HeightMap heightMap) {
    var chunk = terrain.chunk(Math.floorDiv(x, 16), Math.floorDiv(z, 16));
    var top = chunk.top(Math.floorMod(x, 16), Math.floorMod(z, 16));
    return top.isPresent() ? top.getAsInt() + verticalOffset + 1 : worldInfo.getMinHeight();
  }

  @Override
  public BiomeProvider getDefaultBiomeProvider(WorldInfo worldInfo) {
    return new SkylandsBiomes(worldInfo.vanillaBiomeProvider(), biomeRemap);
  }

  @Override
  public Location getFixedSpawnLocation(World world, Random random) {
    return new Location(
        world, spawn.x() + 0.5, spawn.top() + verticalOffset + 1.0, spawn.z() + 0.5);
  }

  @Override
  public List<BlockPopulator> getDefaultPopulators(World world) {
    return List.of();
  }

  @Override
  public boolean shouldGenerateNoise(WorldInfo worldInfo, Random random, int chunkX, int chunkZ) {
    return false;
  }

  @Override
  public boolean shouldGenerateSurface(WorldInfo worldInfo, Random random, int chunkX, int chunkZ) {
    return true;
  }

  @Override
  public boolean shouldGenerateCaves(WorldInfo worldInfo, Random random, int chunkX, int chunkZ) {
    return true;
  }

  @Override
  public boolean shouldGenerateDecorations(
      WorldInfo worldInfo, Random random, int chunkX, int chunkZ) {
    return true;
  }

  @Override
  public boolean shouldGenerateMobs(WorldInfo worldInfo, Random random, int chunkX, int chunkZ) {
    return true;
  }

  @Override
  public boolean shouldGenerateStructures(
      WorldInfo worldInfo, Random random, int chunkX, int chunkZ) {
    return true;
  }
}
