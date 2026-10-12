package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapFile;
import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.adapter.content.SchematicReader;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * One {@code rwf/maps/<id>/} folder as the tool reads it: the definition from {@code map.yml} and
 * the terrain from {@code blocks.schem}, cross-checked the way rwf does at enable (folder name,
 * declared hash, region size) but without a server.
 *
 * @param folder the map folder
 * @param definition the parsed {@code map.yml}
 * @param schematic the parsed {@code blocks.schem}
 */
public record MapFolder(Path folder, MapDefinition definition, Schematic schematic) {

  public static final String MAP_FILE = "map.yml";
  public static final String BLOCKS_FILE = "blocks.schem";
  public static final String NAV_FILE = "nav.rwfnav";
  public static final String SUMMARY_FILE = "nav.summary.json";

  /** Reads and cross-checks {@code folder}, or throws naming the first problem. */
  public static MapFolder load(Path folder) {
    var file = ConfigFiles.load(folder.resolve(MAP_FILE), MapFile.class);
    var folderName = String.valueOf(folder.toAbsolutePath().normalize().getFileName());
    if (!folderName.equals(file.id())) {
      throw new IllegalArgumentException(
          folder + " defines map " + file.id() + "; the folder must be named " + file.id());
    }
    var definition = file.toDefinition();
    var blocksFile = folder.resolve(BLOCKS_FILE);
    Schematic schematic;
    try (var in = Files.newInputStream(blocksFile)) {
      schematic = SchematicReader.read(in);
    } catch (IOException e) {
      throw new UncheckedIOException("Required file " + blocksFile + " could not be read", e);
    }
    if (!schematic.sha256().equals(definition.blocksSha256())) {
      throw new IllegalArgumentException(
          "map "
              + definition.id()
              + " declares blocksSha256 "
              + definition.blocksSha256()
              + " but blocks.schem hashes to "
              + schematic.sha256());
    }
    return new MapFolder(folder, definition, schematic);
  }

  public String id() {
    return definition.id();
  }

  public Path navFile() {
    return folder.resolve(NAV_FILE);
  }

  public Path summaryFile() {
    return folder.resolve(SUMMARY_FILE);
  }

  /** The schematic's classification through the block table. */
  public SchematicClassification classify() {
    return SchematicClassification.of(id(), schematic, definition.border());
  }
}
