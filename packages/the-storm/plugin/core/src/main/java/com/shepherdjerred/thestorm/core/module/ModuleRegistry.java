package com.shepherdjerred.thestorm.core.module;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Decides which modules run, in registration order, and fails loudly on a mismatched config. */
public final class ModuleRegistry {

  private ModuleRegistry() {}

  /**
   * Selects the enabled modules.
   *
   * <p>The toggle map must name every registered module exactly once, and nothing else. A missing
   * or unknown key is a configuration error, not a silent default.
   */
  public static Result<List<StormModule>, List<String>> select(
      List<StormModule> registered, ModuleToggles toggles) {
    var problems = new ArrayList<String>();
    var ids = new HashSet<String>();
    for (var module : registered) {
      if (!ids.add(module.id())) {
        problems.add("module id '" + module.id() + "' is registered twice");
      }
    }
    for (var id : ids) {
      if (!toggles.modules().containsKey(id)) {
        problems.add("config.yml modules is missing '" + id + "'");
      }
    }
    for (var key : toggles.modules().keySet()) {
      if (!ids.contains(key)) {
        problems.add("config.yml modules names unknown module '" + key + "'");
      }
    }
    if (!problems.isEmpty()) {
      return Result.err(List.copyOf(problems.stream().sorted().toList()));
    }
    return Result.ok(
        registered.stream()
            .filter(module -> Boolean.TRUE.equals(toggles.modules().get(module.id())))
            .toList());
  }

  /** The ids of {@code modules}, for logging. */
  public static Set<String> ids(List<StormModule> modules) {
    return Set.copyOf(modules.stream().map(StormModule::id).toList());
  }
}
