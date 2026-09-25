package com.shepherdjerred.thestorm;

import com.shepherdjerred.thestorm.core.module.ModuleToggles;
import java.util.Map;

/**
 * {@code plugins/TheStorm/config.yml}. The repository owns this file; the server image writes it on
 * every boot and the plugin never saves it.
 *
 * @param modules module id to enabled flag, listing every module
 */
public record PluginConfig(Map<String, Boolean> modules) {

  public PluginConfig {
    modules = Map.copyOf(modules);
  }

  public ModuleToggles toggles() {
    return new ModuleToggles(modules);
  }
}
