package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails;
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
 * Loads {@code rwf.yml}, {@code rwf/kits.yml}, every {@code rwf/maps/<id>/} and the {@code
 * rwf/lobby/} room from {@code plugins/TheStorm}. Any missing, invalid or disagreeing file stops
 * the module, naming what is wrong.
 */
public final class ContentFiles {

  static final String SETTINGS = "rwf.yml";
  static final String KITS = "rwf/kits.yml";
  static final String MAPS = "rwf/maps";
  static final String MAP_FILE = "map.yml";
  static final String BLOCKS_FILE = "blocks.schem";
  static final String DETAILS_FILE = "details.json";
  static final String LOBBY = "rwf/lobby";
  static final String LOBBY_FILE = "lobby.yml";

  private ContentFiles() {}

  /** Loads required metadata, not every map's decoded terrain, for the live runtime. */
  public static RwfCatalog catalog(Path directory, Function<String, BlockData> blockData) {
    var config = ConfigFiles.load(directory.resolve(SETTINGS), RwfConfig.class);
    var kits = ConfigFiles.load(directory.resolve(KITS), KitsFile.class);
    kits.mustMatch(KitBook.MILESTONE_ONE);
    var sources = new ArrayList<MapSource>();
    for (var folder : mapFolders(directory.resolve(MAPS))) {
      var file = mapFile(folder);
      if (!Files.isRegularFile(folder.resolve(BLOCKS_FILE)))
        throw new IllegalStateException(
            "Required file " + folder.resolve(BLOCKS_FILE) + " is missing");
      if (!Files.isRegularFile(folder.resolve(DETAILS_FILE)))
        throw new IllegalStateException(
            "Required file " + folder.resolve(DETAILS_FILE) + " is missing");
      sources.add(new MapSource(file.toDefinition(), folder, blockData));
    }
    return new RwfCatalog(
        config, KitBook.MILESTONE_ONE, sources, lobby(directory.resolve(LOBBY), blockData));
  }

  /**
   * Loads and cross-checks everything under {@code directory}; {@code blockData} parses palette
   * entries (normally {@code Bukkit::createBlockData}).
   */
  public static RwfContent load(Path directory, Function<String, BlockData> blockData) {
    var config = ConfigFiles.load(directory.resolve(SETTINGS), RwfConfig.class);
    var kits = ConfigFiles.load(directory.resolve(KITS), KitsFile.class);
    kits.mustMatch(KitBook.MILESTONE_ONE);
    var maps = maps(directory.resolve(MAPS), blockData);
    var lobby = lobby(directory.resolve(LOBBY), blockData);
    try {
      return new RwfContent(config, KitBook.MILESTONE_ONE, maps, lobby);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("rwf content does not agree: " + e.getMessage(), e);
    }
  }

  private static List<LoadedMap> maps(Path folder, Function<String, BlockData> blockData) {
    var maps = new ArrayList<LoadedMap>();
    for (var mapFolder : mapFolders(folder)) maps.add(map(mapFolder, blockData));
    return List.copyOf(maps);
  }

  private static List<Path> mapFolders(Path folder) {
    List<Path> folders;
    try (var listing = Files.list(folder)) {
      folders = listing.filter(Files::isDirectory).sorted().toList();
    } catch (IOException e) {
      throw new UncheckedIOException("Required folder " + folder + " could not be read", e);
    }
    if (folders.isEmpty()) {
      throw new IllegalStateException(folder + " has no maps; add at least one <id>/map.yml");
    }
    return folders;
  }

  /** Loads the {@code rwf/lobby/} folder: {@code lobby.yml} and its {@code blocks.schem}. */
  public static LoadedLobby lobby(Path folder, Function<String, BlockData> blockData) {
    var file = ConfigFiles.load(folder.resolve(LOBBY_FILE), LobbyFile.class);
    var layout = file.toLayout();
    var schematic = schematic(folder.resolve(BLOCKS_FILE));
    try {
      var blocks = MapBlocks.resolve(schematic, layout.region(), blockData);
      return new LoadedLobby(layout, blocks, file.blocksSha256());
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("Invalid " + folder + ": " + e.getMessage(), e);
    }
  }

  /** Loads one {@code rwf/maps/<id>/} folder. */
  public static LoadedMap map(Path folder, Function<String, BlockData> blockData) {
    var file = mapFile(folder);
    var definition = file.toDefinition();
    var schematic = schematic(folder.resolve(BLOCKS_FILE));
    try {
      var blocks = MapBlocks.resolve(schematic, definition.border(), blockData);
      return new LoadedMap(
          definition, blocks, ConfigFiles.load(folder.resolve(DETAILS_FILE), MapDetails.class));
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("Invalid " + folder + ": " + e.getMessage(), e);
    }
  }

  private static MapFile mapFile(Path folder) {
    var file = ConfigFiles.load(folder.resolve(MAP_FILE), MapFile.class);
    var expected = file.id();
    if (!folder.getFileName().toString().equals(expected)) {
      throw new IllegalStateException(
          folder + " defines map " + expected + "; name it " + expected);
    }
    return file;
  }

  private static Schematic schematic(Path blocksFile) {
    try (InputStream in = Files.newInputStream(blocksFile)) {
      return SchematicReader.read(in);
    } catch (IOException e) {
      throw new UncheckedIOException("Required file " + blocksFile + " could not be read", e);
    } catch (IllegalArgumentException | UncheckedIOException e) {
      throw new IllegalStateException("Invalid " + blocksFile + ": " + e.getMessage(), e);
    }
  }
}
