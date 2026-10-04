package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Chat;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The exact shape of one {@code rwfbots/personalities/<id>.yml}. Every key is required; enum-like
 * values (kits, roles, levers, verbosity) are lower-case strings so the YAML reads naturally, and
 * {@link #toPersonality()} turns them into the domain record, rejecting anything it does not know.
 *
 * <p>The generator under {@code packages/the-storm/scripts/bots} writes this shape and validates it
 * with a mirroring zod schema; change both together.
 *
 * @param id the catalog id, also the file name without {@code .yml}
 * @param name the in-game name
 * @param skin the Mojang texture property
 * @param skill base skill 0..1
 * @param leverOffsets z-scores by lever key, such as {@code reactionMs}
 * @param kits positive weights by lower-case kit name
 * @param roles positive weights by lower-case role name
 * @param style play style, each 0..1
 * @param chat how it talks
 * @param bio a short description
 * @param batch the authoring batch number, from 1
 * @param retired whether it is kept for history but never drafted
 */
record PersonalityFile(
    String id,
    String name,
    Skin skin,
    double skill,
    Map<String, Double> leverOffsets,
    Map<String, Double> kits,
    Map<String, Double> roles,
    StyleShape style,
    ChatShape chat,
    String bio,
    int batch,
    boolean retired) {

  /** A signed Mojang texture property. */
  record Skin(String value, String signature) {}

  /** {@link Style} as written in YAML. */
  record StyleShape(double aggression, double patience, double teamplay, double risk) {}

  /** {@link Chat} as written in YAML; {@code verbosity} is {@code silent|terse|chatty}. */
  record ChatShape(List<String> tone, String verbosity, List<String> catchphrases) {}

  /** The domain record; an unknown kit, role, lever or verbosity is an error. */
  Personality toPersonality() {
    return new Personality(
        id,
        name,
        skin.value(),
        skin.signature(),
        skill,
        LeverOffsets.parse(leverOffsets),
        weights("kit", kits, Kit.values()),
        weights("role", roles, Role.values()),
        new Style(style.aggression(), style.patience(), style.teamplay(), style.risk()),
        new Chat(chat.tone(), verbosity(chat.verbosity()), chat.catchphrases()),
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

  /** The constant whose lower-case name is {@code key}: {@code trooper}, {@code plant}, ... */
  private static <K extends Enum<K>> K constant(String what, String key, K[] constants) {
    for (var constant : constants) {
      if (constant.name().toLowerCase(Locale.ROOT).equals(key)) {
        return constant;
      }
    }
    throw new IllegalArgumentException("unknown " + what + ": " + key);
  }

  private static Chat.Verbosity verbosity(String key) {
    return constant("verbosity", key, Chat.Verbosity.values());
  }
}
