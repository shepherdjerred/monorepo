package com.shepherdjerred.thestorm;

import io.papermc.paper.datapack.Datapack;
import io.papermc.paper.datapack.DatapackRegistrar;
import io.papermc.paper.plugin.bootstrap.BootstrapContext;
import io.papermc.paper.plugin.bootstrap.PluginBootstrap;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URISyntaxException;
import net.kyori.adventure.text.Component;

/**
 * Registers datapacks before worlds load. The quiet iron-pick pack keeps {@code
 * minecraft:story/iron_tools} ("Isn't It Iron Pick?") and turns off its toast and chat line,
 * because the starter kit hands every new player an iron pickaxe. The Storm pack adds the server's
 * advancement tabs. It is not pinned above vanilla packs.
 */
public final class TheStormBootstrap implements PluginBootstrap {

  static final String PACK_META = "/datapacks/quiet-iron-pick/pack.mcmeta";

  private static final String STORM_PACK_META = "/datapacks/the-storm/pack.mcmeta";

  @Override
  public void bootstrap(BootstrapContext context) {
    context
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.DATAPACK_DISCOVERY, event -> discover(event.registrar()));
  }

  private static void discover(DatapackRegistrar registrar) {
    discover(
        registrar,
        new Pack(
            packRoot(),
            "quiet_iron_pick",
            "Quiet iron pick",
            true,
            "the quiet iron pick datapack was rejected",
            "the quiet iron pick datapack could not be read"));
    discover(
        registrar,
        new Pack(
            resourceRoot(STORM_PACK_META, "the storm datapack URI"),
            "the_storm",
            "The Storm",
            false,
            "the storm datapack was rejected",
            "the storm datapack could not be read"));
  }

  /** A datapack registered before worlds load. {@code top} pins it above vanilla packs. */
  private record Pack(
      URI root, String id, String title, boolean top, String rejected, String unreadable) {}

  private static void discover(DatapackRegistrar registrar, Pack pack) {
    try {
      var discovered =
          registrar.discoverPack(
              pack.root(),
              pack.id(),
              config -> {
                config.title(Component.text(pack.title()));
                config.autoEnableOnServerStart(true);
                if (pack.top()) {
                  config.position(true, Datapack.Position.TOP);
                }
              });
      if (discovered == null) {
        throw new IllegalStateException(pack.rejected());
      }
    } catch (IOException failure) {
      throw new UncheckedIOException(pack.unreadable(), failure);
    }
  }

  /** The quiet iron-pick directory that contains {@code pack.mcmeta}. */
  static URI packRoot() {
    return resourceRoot(PACK_META, "quiet iron pick datapack URI");
  }

  private static URI resourceRoot(String metaPath, String uriProblem) {
    var meta = TheStormBootstrap.class.getResource(metaPath);
    if (meta == null) {
      throw new IllegalStateException("missing " + metaPath);
    }
    try {
      return packRoot(meta.toURI());
    } catch (URISyntaxException failure) {
      throw new IllegalStateException(uriProblem, failure);
    }
  }

  /**
   * Parent directory of a {@code pack.mcmeta} URI. A packaged plugin resource is an opaque {@code
   * jar:} URI, and {@link URI#resolve} on an opaque URI returns the relative argument unchanged.
   */
  static URI packRoot(URI meta) {
    var text = meta.toString();
    var file = "pack.mcmeta";
    if (!text.endsWith("/" + file)) {
      throw new IllegalStateException("datapack URI");
    }
    return URI.create(text.substring(0, text.length() - file.length()));
  }
}
