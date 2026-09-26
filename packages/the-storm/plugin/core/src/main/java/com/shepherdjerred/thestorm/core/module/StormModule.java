package com.shepherdjerred.thestorm.core.module;

/**
 * A gameplay module. Each module owns one feature area (economy, towns, quests, ...) and is enabled
 * or disabled as a unit by {@code config.yml}.
 */
public interface StormModule {

  /** A stable, lowercase identifier, also used as the config toggle key and migration folder. */
  String id();

  /** Starts the module: registers listeners and commands, loads content, migrates storage. */
  void enable(ModuleContext context);

  /** Stops the module. Called in reverse enable order. */
  default void disable() {}
}
