package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotTemplate;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Biome;
import org.bukkit.block.data.BlockData;
import org.bukkit.generator.BiomeProvider;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.generator.WorldInfo;
import org.jspecify.annotations.Nullable;

/**
 * Stamps the recovered plot square into chunks that do not exist yet. Existing 2016 chunks are left
 * alone: Paper only asks a generator for missing chunks. These writes go through chunk data, so
 * generated squares are not CoreProtect player history.
 */
public final class CreativeGenerator extends ChunkGenerator {

  private static final String TEMPLATE = "/creative-template.bin";

  private final PlotTemplate template;
  private final Map<String, BlockData> blocks;

  public CreativeGenerator(PlotTemplate template) {
    this.template = template;
    if (!"minecraft:bedrock".equals(template.stateAt(0, 0, 0))) {
      throw new IllegalArgumentException("creative template floor is not bedrock at the origin");
    }
    var cached = new HashMap<String, BlockData>();
    for (var state : template.states()) {
      cached.put(state, Bukkit.createBlockData(state));
    }
    for (var state :
        new String[] {
          "minecraft:air",
          "minecraft:bedrock",
          "minecraft:stone",
          "minecraft:quartz_block",
          "minecraft:grass_block",
          "minecraft:stone_brick_slab[type=bottom,waterlogged=false]"
        }) {
      cached.computeIfAbsent(state, Bukkit::createBlockData);
    }
    this.blocks = Map.copyOf(cached);
  }

  /** The recovered square, including the decorated roads. */
  public PlotTemplate template() {
    return template;
  }

  /** Generator for {@code grid}, using the template shipped in this jar. */
  public static CreativeGenerator open(PlotGrid grid) {
    try (var in = CreativeGenerator.class.getResourceAsStream(TEMPLATE)) {
      if (in == null) {
        throw new IllegalStateException("Missing creative template " + TEMPLATE);
      }
      return new CreativeGenerator(PlotTemplate.decode(grid, in.readAllBytes()));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Override
  public void generateNoise(
      WorldInfo worldInfo, Random random, int chunkX, int chunkZ, ChunkData chunkData) {
    int minY = chunkData.getMinHeight();
    int maxY = chunkData.getMaxHeight();
    int originX = chunkX << 4;
    int originZ = chunkZ << 4;
    for (int lx = 0; lx < 16; lx++) {
      for (int lz = 0; lz < 16; lz++) {
        int x = originX + lx;
        int z = originZ + lz;
        for (int y = minY; y < maxY; y++) {
          var state = template.stateAt(x, y, z);
          if (!"minecraft:air".equals(state)) {
            chunkData.setBlock(lx, y, lz, block(state));
          }
        }
      }
    }
  }

  @Override
  public @Nullable BiomeProvider getDefaultBiomeProvider(WorldInfo worldInfo) {
    return new Plains();
  }

  @Override
  public @Nullable Location getFixedSpawnLocation(World world, Random random) {
    return new Location(world, PlotGrid.SPAWN_X + 0.5, PlotGrid.SPAWN_Y, PlotGrid.SPAWN_Z + 0.5);
  }

  @Override
  public boolean shouldGenerateNoise() {
    return false;
  }

  @Override
  public boolean shouldGenerateSurface() {
    return false;
  }

  @Override
  public boolean shouldGenerateCaves() {
    return false;
  }

  @Override
  public boolean shouldGenerateDecorations() {
    return false;
  }

  @Override
  public boolean shouldGenerateMobs() {
    return false;
  }

  @Override
  public boolean shouldGenerateStructures() {
    return false;
  }

  private BlockData block(String state) {
    var data = blocks.get(state);
    if (data == null) {
      throw new IllegalStateException("creative template uses an uncached block " + state);
    }
    return data;
  }

  /** Every column is plains, matching the flat plot world the roads were built on. */
  private static final class Plains extends BiomeProvider {

    @Override
    public Biome getBiome(WorldInfo worldInfo, int x, int y, int z) {
      return Biome.PLAINS;
    }

    @Override
    public List<Biome> getBiomes(WorldInfo worldInfo) {
      return List.of(Biome.PLAINS);
    }
  }
}
