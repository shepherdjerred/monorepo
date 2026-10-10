package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.nio.file.Path;
import java.util.function.Function;
import org.bukkit.block.data.BlockData;

/** A small catalog entry; decoding terrain belongs on the compute pool during preparation. */
public record MapSource(MapDefinition definition, Path folder, Function<String, BlockData> parser) {
  public String id() {
    return definition.id();
  }

  /** Reads and validates the entire terrain without retaining it in the catalog. */
  public LoadedMap load() {
    var loaded = ContentFiles.map(folder, parser);
    if (!loaded.definition().equals(definition))
      throw new IllegalStateException("Map " + id() + " changed after the catalog was loaded");
    return loaded;
  }
}
