package com.shepherdjerred.thestorm.quests.app;

import org.bukkit.entity.Player;

/**
 * How other modules extend quests: they report progress on custom objectives ({@code custom HOOK
 * N}) and carry out custom actions ({@code custom HOOK ARGUMENT}). Hook ids are declared in quest
 * content under {@code hooks:}. This is the extension point for later systems: dialogue runtimes,
 * cutscenes, world events and community projects. Main thread.
 */
public interface QuestHooks {

  /** {@code player} made {@code amount} progress on custom objective {@code hook}. */
  void progress(Player player, String hook, int amount);

  /**
   * Registers what {@code custom HOOK ARGUMENT} actions do. One handler per hook; registering a
   * hook twice is a wiring bug.
   */
  void onAction(String hook, CustomAction action);

  /** A custom action. Runs on the main thread. */
  @FunctionalInterface
  interface CustomAction {

    void run(Player player, String argument);
  }
}
