package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import org.bukkit.block.data.BlockData;

/**
 * Loads {@code rwf.yml}, {@code rwf/kits.yml} and every {@code rwf/maps/<id>/} from {@code
 * plugins/TheStorm}. Any missing, invalid or disagreeing file stops the module, naming what is
 * wrong.
 */
public final class ContentFiles {

  static final String SETTINGS = "rwf.yml";
  static final String KITS = "rwf/kits.yml";
  static final String MAPS = "rwf/maps";
  static final String MAP_FILE = "map.yml";
  static final String BLOCKS_FILE = "blocks.schem";

  private ContentFiles() {}

  /**
   * Loads and cross-checks everything under {@code directory}; {@code blockData} parses palette
   * entries (normally {@code Bukkit::createBlockData}).
   */
  public static RwfContent load(Path directory, Function<String, BlockData> blockData) {
    var config = ConfigFiles.load(directory.resolve(SETTINGS), RwfConfig.class);
    var kits = ConfigFiles.load(directory.resolve(KITS), KitsFile.class);
    kits.mustMatch(KitBook.MILESTONE_ONE);
    var maps = maps(directory.resolve(MAPS), blockData);
    try {
      return new RwfContent(config, KitBook.MILESTONE_ONE, maps);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("rwf content does not agree: " + e.getMessage(), e);
    }
  }

  private static List<LoadedMap> maps(Path folder, Function<String, BlockData> blockData) {
    List<Path> folders;
    try (var listing = Files.list(folder)) {
      folders = listing.filter(Files::isDirectory).sorted().toList();
    } catch (IOException e) {
      throw new UncheckedIOException("Required folder " + folder + " could not be read", e);
    }
    if (folders.isEmpty()) {
      throw new IllegalStateException(folder + " has no maps; add at least one <id>/map.yml");
    }
    var maps = new ArrayList<LoadedMap>();
    for (var mapFolder : folders) {
      maps.add(map(mapFolder, blockData));
    }
    return List.copyOf(maps);
  }

  /** Loads one {@code rwf/maps/<id>/} folder. */
  public static LoadedMap map(Path folder, Function<String, BlockData> blockData) {
    var file = ConfigFiles.load(folder.resolve(MAP_FILE), MapFile.class);
    var expected = file.id();
    if (!folder.getFileName().toString().equals(expected)) {
      throw new IllegalStateException(
          folder + " defines map " + expected + "; name it " + expected);
    }
    var definition = file.toDefinition();
    var blocksFile = folder.resolve(BLOCKS_FILE);
    Schematic schematic;
    try (InputStream in = Files.newInputStream(blocksFile)) {
      schematic = SchematicReader.read(in);
    } catch (IOException e) {
      throw new UncheckedIOException("Required file " + blocksFile + " could not be read", e);
    } catch (IllegalArgumentException | UncheckedIOException e) {
      throw new IllegalStateException("Invalid " + blocksFile + ": " + e.getMessage(), e);
    }
    try {
      var blocks = MapBlocks.resolve(schematic, definition.border(), blockData);
      return new LoadedMap(definition, blocks);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("Invalid " + folder + ": " + e.getMessage(), e);
    }
  }
}
