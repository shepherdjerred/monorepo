package com.shepherdjerred.thestorm.rwfbots.domain.personality;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.EnumMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * One bot persona: a stable identity players can recognise across matches.
 *
 * @param id a lower-case slug, unique in the catalog
 * @param name the in-game name, 3..16 of {@code [A-Za-z0-9_]}, unique in the catalog
 * @param skinValue the Mojang texture property value
 * @param skinSignature the Mojang texture property signature
 * @param skill base skill 0..1 before match shift
 * @param leverOffsets standing lever deviations
 * @param kits positive weights over the kits it picks from
 * @param roles positive weights over the roles it prefers
 * @param style play style
 * @param chat how it talks
 * @param bio a short description, up to 280 characters
 * @param batch which authoring batch introduced it, from 1
 * @param retired whether it is kept for history but never drafted
 */
public record Personality(
    String id,
    String name,
    String skinValue,
    String skinSignature,
    double skill,
    LeverOffsets leverOffsets,
    Map<Kit, Double> kits,
    Map<Role, Double> roles,
    Style style,
    Chat chat,
    String bio,
    int batch,
    boolean retired) {

  public static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9-]{1,31}");
  public static final Pattern NAME = Pattern.compile("[A-Za-z0-9_]{3,16}");
  public static final int MAX_BIO_LENGTH = 280;

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
    if (bio.length() > MAX_BIO_LENGTH) {
      throw new IllegalArgumentException(id + ": bio must be at most 280 characters");
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
