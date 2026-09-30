package com.shepherdjerred.thestorm.npcs.domain.content;

import java.util.List;
import java.util.Map;

/**
 * One file under {@code plugins/TheStorm/npcs/}, exactly as written. Every section is required
 * (write {@code {}} for an empty one) and ids are global across files. {@link ContentCompiler}
 * validates the files together into {@link Content}.
 *
 * <p>Optional references are written explicitly as {@code none}, so a forgotten key is an error
 * rather than a silent default.
 *
 * @param places named spots that schedules refer to
 * @param skins signed skin textures, referred to by NPCs
 * @param schedules daily routines
 * @param dialogues conversations
 * @param npcs the NPCs
 */
public record ContentFile(
    Map<String, SpotEntry> places,
    Map<String, SkinEntry> skins,
    Map<String, ScheduleEntry> schedules,
    Map<String, DialogueEntry> dialogues,
    Map<String, NpcEntry> npcs) {

  /**
   * A position with a facing.
   *
   * @param world the world's key, such as {@code minecraft:overworld}
   */
  public record SpotEntry(String world, double x, double y, double z, float yaw, float pitch) {}

  /**
   * A skin's signed {@code textures} property, copied from {@code
   * https://sessionserver.mojang.com/session/minecraft/profile/<uuid>?unsigned=false}.
   */
  public record SkinEntry(String value, String signature) {}

  /**
   * A daily routine.
   *
   * @param shelter the place to go while it rains, or {@code none}
   * @param slots time ranges and what to do in them; together they cover the day exactly once
   */
  public record ScheduleEntry(String shelter, List<SlotEntry> slots) {}

  /**
   * A part of the day. {@code from} and {@code to} are {@code HH:MM}; the range may wrap past
   * midnight, and equal ends mean the whole day.
   *
   * @param activity {@code stay <place>}, {@code wander <place> <radius>}, {@code patrol <place>
   *     <place>...} or {@code sleep <place>}
   */
  public record SlotEntry(String from, String to, String activity) {}

  /** A conversation. */
  public record DialogueEntry(String title, String start, Map<String, NodeEntry> nodes) {}

  /**
   * A dialogue screen: either {@code next} (a node id, shown as a Continue button) with no options,
   * or {@code next: none} with options.
   */
  public record NodeEntry(String text, String next, List<OptionEntry> options) {}

  /**
   * A button.
   *
   * @param then {@code close}, {@code goto:<node>}, {@code trainer} or {@code action:<id>}
   */
  public record OptionEntry(String label, String then) {}

  /**
   * An NPC.
   *
   * @param name shown above its head, on Java and Bedrock
   * @param description the line under the name, on Java only
   * @param skin {@code none}, {@code vanilla:<wide|slim>/<name>} or a skin id
   * @param pose {@code standing}, {@code sneaking}, {@code sleeping}, {@code swimming} or {@code
   *     fall_flying}
   * @param roles role tags
   * @param schedule a schedule id, or {@code none} to stand at home
   * @param dialogue a dialogue id, or {@code none}
   * @param trainer a track id, or {@code none}
   */
  public record NpcEntry(
      String name,
      String description,
      String skin,
      SpotEntry home,
      String pose,
      List<String> roles,
      String schedule,
      String dialogue,
      String trainer) {}
}
