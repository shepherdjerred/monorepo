package com.shepherdjerred.thestorm.rwfbots.domain.personality;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * One bot persona: a stable identity players can recognise across matches.
 *
 * @param id a lower-case slug, unique in the catalog
 * @param name the in-game name, 3..16 of {@code [A-Za-z0-9_]}, unique in the catalog
 * @param skinValue the Mojang texture property value
 * @param skinSignature the Mojang texture property signature
 * @param skill base skill 0..1 before match shift
 * @param archetype the kind of player it is; its knobs were derived from it
 * @param leverOffsets standing lever deviations
 * @param kits positive weights over the kits it picks from
 * @param roles positive weights over the roles it prefers
 * @param style play style
 * @param voice how it talks
 * @param lines what it says, by moment
 * @param quirks one to three habits
 * @param rivals up to three other personality ids it has history with
 * @param bio one to three sentences of backstory, up to 300 characters
 * @param batch which authoring batch introduced it, from 1
 * @param retired whether it is kept for history but never drafted
 */
public record Personality(
    String id,
    String name,
    String skinValue,
    String skinSignature,
    double skill,
    Archetype archetype,
    LeverOffsets leverOffsets,
    Map<Kit, Double> kits,
    Map<Role, Double> roles,
    Style style,
    Voice voice,
    Lines lines,
    Set<Quirk> quirks,
    List<String> rivals,
    String bio,
    int batch,
    boolean retired) {

  public static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9-]{1,31}");
  public static final Pattern NAME = Pattern.compile("[A-Za-z0-9_]{3,16}");
  public static final int MAX_BIO_LENGTH = 300;
  public static final int MAX_QUIRKS = 3;
  public static final int MAX_RIVALS = 3;

  public Personality {
    if (!ID.matcher(id).matches()) {
      throw new IllegalArgumentException("bad personality id: '" + id + "'");
    }
    if (name.startsWith(".")) {
      throw new IllegalArgumentException("name must not start with a dot: '" + name + "'");
    }
    if (!NAME.matcher(name).matches()) {
      throw new IllegalArgumentException("name must be 3..16 of [A-Za-z0-9_]: '" + name + "'");
    }
    if (skinValue.isBlank() || skinSignature.isBlank()) {
      throw new IllegalArgumentException(id + ": skin value and signature must not be blank");
    }
    if (!(skill >= 0 && skill <= 1)) {
      throw new IllegalArgumentException(id + ": skill must be 0..1: " + skill);
    }
    kits = weights(id, "kit", kits, Kit.class);
    roles = weights(id, "role", roles, Role.class);
    if (quirks.isEmpty() || quirks.size() > MAX_QUIRKS) {
      throw new IllegalArgumentException(id + ": needs 1..3 quirks: " + quirks);
    }
    quirks = Set.copyOf(EnumSet.copyOf(quirks));
    rivals = List.copyOf(rivals);
    if (rivals.size() > MAX_RIVALS || new HashSet<>(rivals).size() != rivals.size()) {
      throw new IllegalArgumentException(id + ": at most three distinct rivals: " + rivals);
    }
    for (var rival : rivals) {
      if (rival.equals(id) || !ID.matcher(rival).matches()) {
        throw new IllegalArgumentException(id + ": bad rival: '" + rival + "'");
      }
    }
    if (bio.isBlank() || !bio.strip().equals(bio) || bio.length() > MAX_BIO_LENGTH) {
      throw new IllegalArgumentException(
          id + ": bio must be 1..300 characters with no surrounding space");
    }
    if (batch < 1) {
      throw new IllegalArgumentException(id + ": batch must be at least 1: " + batch);
    }
  }

  private static <K extends Enum<K>> Map<K, Double> weights(
      String id, String what, Map<K, Double> weights, Class<K> type) {
    if (weights.isEmpty()) {
      throw new IllegalArgumentException(id + ": at least one " + what + " weight is required");
    }
    var copy = new EnumMap<K, Double>(type);
    weights.forEach(
        (key, weight) -> {
          if (!(weight > 0) || !Double.isFinite(weight)) {
            throw new IllegalArgumentException(
                id + ": " + what + " weight for " + key + " must be positive: " + weight);
          }
          copy.put(key, weight);
        });
    return Map.copyOf(copy);
  }
}
