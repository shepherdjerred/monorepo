package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Voice;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The exact shape of one {@code rwfbots/personalities/<id>.yml}. Every key is required; enum-like
 * values (archetype, kits, roles, levers, verbosity, quirks) are lower-case strings so the YAML
 * reads naturally, and {@link #toPersonality()} turns them into the domain record, rejecting
 * anything it does not know.
 *
 * <p>The generator under {@code packages/the-storm/scripts/bots} writes this shape and validates it
 * with a mirroring zod schema; change both together.
 *
 * @param id the catalog id, also the file name without {@code .yml}
 * @param name the in-game name
 * @param skin the Mojang texture property
 * @param skill base skill 0..1
 * @param archetype lower-case {@link Archetype}, such as {@code bomb_diver}
 * @param leverOffsets z-scores by lever key, such as {@code reactionMs}
 * @param kits positive weights by lower-case kit name
 * @param roles positive weights by lower-case role name
 * @param style play style, each 0..1
 * @param voice how it talks
 * @param lines chat lines by moment
 * @param quirks lower-case {@link Quirk} names
 * @param rivals other personality ids
 * @param bio one to three sentences of backstory
 * @param batch the authoring batch number, from 1
 * @param retired whether it is kept for history but never drafted
 */
record PersonalityFile(
    String id,
    String name,
    Skin skin,
    double skill,
    String archetype,
    Map<String, Double> leverOffsets,
    Map<String, Double> kits,
    Map<String, Double> roles,
    StyleShape style,
    VoiceShape voice,
    LinesShape lines,
    List<String> quirks,
    List<String> rivals,
    String bio,
    int batch,
    boolean retired) {

  /** A signed Mojang texture property. */
  record Skin(String value, String signature) {}

  /** {@link Style} as written in YAML. */
  record StyleShape(double aggression, double patience, double teamplay, double risk) {}

  /** {@link Voice} as written in YAML; {@code verbosity} is {@code quiet|normal|chatty}. */
  record VoiceShape(List<String> tone, String verbosity, String style) {}

  /** {@link Lines} as written in YAML, one list per moment. */
  record LinesShape(
      List<String> greet,
      List<String> onKill,
      List<String> onDeath,
      List<String> onPlant,
      List<String> onDefuse,
      List<String> onWin,
      List<String> onLoss,
      List<String> onLastAlive,
      List<String> taunt,
      List<String> lobby) {}

  /** The domain record; an unknown archetype, kit, role, lever, verbosity or quirk is an error. */
  Personality toPersonality() {
    return new Personality(
        id,
        name,
        skin.value(),
        skin.signature(),
        skill,
        constant("archetype", archetype, Archetype.values()),
        LeverOffsets.parse(leverOffsets),
        weights("kit", kits, Kit.values()),
        weights("role", roles, Role.values()),
        new Style(style.aggression(), style.patience(), style.teamplay(), style.risk()),
        new Voice(
            voice.tone(),
            constant("verbosity", voice.verbosity(), Voice.Verbosity.values()),
            voice.style()),
        new Lines(
            lines.greet(),
            lines.onKill(),
            lines.onDeath(),
            lines.onPlant(),
            lines.onDefuse(),
            lines.onWin(),
            lines.onLoss(),
            lines.onLastAlive(),
            lines.taunt(),
            lines.lobby()),
        quirks(quirks),
        rivals,
        bio,
        batch,
        retired);
  }

  private static <K extends Enum<K>> Map<K, Double> weights(
      String what, Map<String, Double> byKey, K[] constants) {
    var map = new EnumMap<K, Double>(constants[0].getDeclaringClass());
    byKey.forEach((key, weight) -> map.put(constant(what, key, constants), weight));
    return map;
  }

  /** The constant whose lower-case name is {@code key}: {@code trooper}, {@code bomb_diver}, ... */
  private static <K extends Enum<K>> K constant(String what, String key, K[] constants) {
    for (var constant : constants) {
      if (constant.name().toLowerCase(Locale.ROOT).equals(key)) {
        return constant;
      }
    }
    throw new IllegalArgumentException("unknown " + what + ": " + key);
  }

  private static EnumSet<Quirk> quirks(List<String> keys) {
    var set = EnumSet.noneOf(Quirk.class);
    for (var key : keys) {
      if (!set.add(constant("quirk", key, Quirk.values()))) {
        throw new IllegalArgumentException("duplicate quirk: " + key);
      }
    }
    return set;
  }
}
