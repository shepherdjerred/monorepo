package com.shepherdjerred.thestorm.skylands.adapter.resource;

import com.shepherdjerred.thestorm.skylands.adapter.paper.NativeSkyTemplates;
import com.shepherdjerred.thestorm.skylands.app.SkylandsAssets;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.TreeMap;
import org.bukkit.Bukkit;

/** Reads licensed built-in resources during Paper bootstrap, before its server thread exists. */
public final class NativeSkyAssetSource {
  private NativeSkyAssetSource() {}

  public static SkylandsAssets read() {
    var templates = new TreeMap<String, byte[]>();
    for (var key : NativeSkyTemplates.keys()) {
      var resource = "data/minecraft/structure/" + key + ".nbt";
      try (var input = Bukkit.class.getClassLoader().getResourceAsStream(resource)) {
        if (input == null)
          throw new IllegalStateException("Missing native Skylands resource " + key);
        templates.put(key, input.readAllBytes());
      } catch (IOException failure) {
        throw new UncheckedIOException("Could not read native Skylands resource " + key, failure);
      }
    }
    return new SkylandsAssets(templates);
  }
}
