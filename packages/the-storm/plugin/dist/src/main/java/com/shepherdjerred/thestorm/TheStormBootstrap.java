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
 * Registers the quiet iron-pick datapack before worlds load. The starter kit hands every new player
 * an iron pickaxe, which completes {@code minecraft:story/iron_tools} ("Isn't It Iron Pick?"). The
 * pack keeps that advancement and turns off its toast and chat line.
 */
public final class TheStormBootstrap implements PluginBootstrap {

  static final String PACK_META = "/datapacks/quiet-iron-pick/pack.mcmeta";

  @Override
  public void bootstrap(BootstrapContext context) {
    context
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.DATAPACK_DISCOVERY, event -> discover(event.registrar()));
  }

  private static void discover(DatapackRegistrar registrar) {
    try {
      var pack =
          registrar.discoverPack(
              packRoot(),
              "quiet_iron_pick",
              config -> {
                config.title(Component.text("Quiet iron pick"));
                config.autoEnableOnServerStart(true);
                config.position(true, Datapack.Position.TOP);
              });
      if (pack == null) {
        throw new IllegalStateException("the quiet iron pick datapack was rejected");
      }
    } catch (IOException failure) {
      throw new UncheckedIOException("the quiet iron pick datapack could not be read", failure);
    }
  }

  /** The pack directory that contains {@code pack.mcmeta}. */
  static URI packRoot() {
    var meta = TheStormBootstrap.class.getResource(PACK_META);
    if (meta == null) {
      throw new IllegalStateException("missing " + PACK_META);
    }
    try {
      return meta.toURI().resolve(".");
    } catch (URISyntaxException failure) {
      throw new IllegalStateException("quiet iron pick datapack URI", failure);
    }
  }
}
