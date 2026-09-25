package com.shepherdjerred.thestorm.core.module;

import java.util.Map;
import java.util.TreeMap;

/**
 * Which modules are switched on, as read from {@code config.yml}.
 *
 * @param modules module id to enabled flag; every registered module must be listed
 */
public record ModuleToggles(Map<String, Boolean> modules) {

  public ModuleToggles {
    modules = Map.copyOf(new TreeMap<>(modules));
  }
}
