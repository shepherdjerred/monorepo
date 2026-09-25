package com.shepherdjerred.thestorm.npcs.adapter.paper;

import org.bukkit.NamespacedKey;
import org.bukkit.plugin.Plugin;

/**
 * The persistent-data keys that mark our entities.
 *
 * @param npc {@code thestorm:npc}, the NPC id on a Mannequin
 * @param fingerprint the definition fingerprint the Mannequin was last set up from
 * @param skin the skin the Mannequin wears, so the profile is only touched when it changes
 * @param navigator marks a hidden navigator mob
 * @param marker marks a quest-marker text display
 */
public record NpcKeys(
    NamespacedKey npc,
    NamespacedKey fingerprint,
    NamespacedKey skin,
    NamespacedKey navigator,
    NamespacedKey marker) {

  public static NpcKeys of(Plugin plugin) {
    return new NpcKeys(
        new NamespacedKey(plugin, "npc"),
        new NamespacedKey(plugin, "npc_fingerprint"),
        new NamespacedKey(plugin, "npc_skin"),
        new NamespacedKey(plugin, "npc_navigator"),
        new NamespacedKey(plugin, "npc_marker"));
  }
}
