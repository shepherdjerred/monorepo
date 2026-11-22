package com.shepherdjerred.thestorm.stats.domain;

import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/** Classifies survival kills and deaths outside minigame and creative worlds. */
public final class CombatClassifier {

  private static final int MAX_NAME_LENGTH = 64;
  private static final int MAX_MOB_LENGTH = 64;
  private static final int MAX_WEAPON_LENGTH = 80;
  private static final Pattern NON_IDENTIFIER = Pattern.compile("[^A-Z0-9_]+");

  private CombatClassifier() {}

  public record CombatActor(UUID uuid, String name) {
    public CombatActor {
      name = boundName(name);
    }
  }

  public record ClassifiedCombat(
      CombatKind kind,
      @Nullable CombatActor killer,
      @Nullable CombatActor victim,
      @Nullable String mobType,
      String weapon,
      WorldBucket world) {}

  public record SurvivalContext(WorldBucket world, boolean inArena) {
    public boolean eligible() {
      return WorldClassifier.isSurvivalCombatWorld(world, inArena);
    }
  }

  public static Optional<ClassifiedCombat> pvp(
      CombatActor killer, CombatActor victim, @Nullable String rawWeapon, SurvivalContext context) {
    if (!context.eligible()) {
      return Optional.empty();
    }
    if (killer.uuid().equals(victim.uuid())) {
      return envDeath(victim, rawWeapon, context);
    }
    return Optional.of(
        new ClassifiedCombat(
            CombatKind.PVP,
            killer,
            victim,
            null,
            normalizeWeapon(rawWeapon, "FISTS"),
            context.world()));
  }

  public static Optional<ClassifiedCombat> pveKill(
      CombatActor killer, String rawMobType, @Nullable String rawWeapon, SurvivalContext context) {
    if (!context.eligible()) {
      return Optional.empty();
    }
    return Optional.of(
        new ClassifiedCombat(
            CombatKind.PVE_KILL,
            killer,
            null,
            normalizeMobType(rawMobType),
            normalizeWeapon(rawWeapon, "FISTS"),
            context.world()));
  }

  public static Optional<ClassifiedCombat> pveDeath(
      CombatActor victim, String rawMobType, @Nullable String rawCause, SurvivalContext context) {
    if (!context.eligible()) {
      return Optional.empty();
    }
    var mob = normalizeMobType(rawMobType);
    return Optional.of(
        new ClassifiedCombat(
            CombatKind.PVE_DEATH,
            null,
            victim,
            mob,
            normalizeWeapon(rawCause, mob),
            context.world()));
  }

  public static Optional<ClassifiedCombat> envDeath(
      CombatActor victim, @Nullable String rawCause, SurvivalContext context) {
    if (!context.eligible()) {
      return Optional.empty();
    }
    return Optional.of(
        new ClassifiedCombat(
            CombatKind.ENV_DEATH,
            null,
            victim,
            null,
            normalizeWeapon(rawCause, "ENVIRONMENT"),
            context.world()));
  }

  public static String normalizeWeapon(@Nullable String rawWeapon, String fallback) {
    var normalized = sanitizeToken(rawWeapon, MAX_WEAPON_LENGTH);
    if (normalized.isEmpty()
        || normalized.equals("AIR")
        || normalized.equals("CAVE_AIR")
        || normalized.equals("VOID_AIR")) {
      var cleanFallback = sanitizeToken(fallback, MAX_WEAPON_LENGTH);
      return cleanFallback.isEmpty() ? "UNKNOWN" : cleanFallback;
    }
    return normalized;
  }

  public static String normalizeMobType(@Nullable String rawMobType) {
    var normalized = sanitizeToken(rawMobType, MAX_MOB_LENGTH);
    return normalized.isEmpty() ? "UNKNOWN" : normalized;
  }

  public static String boundName(@Nullable String rawName) {
    if (rawName == null || rawName.isBlank()) {
      return "unknown";
    }
    var stripped = rawName.strip();
    return stripped.length() > MAX_NAME_LENGTH ? stripped.substring(0, MAX_NAME_LENGTH) : stripped;
  }

  private static String sanitizeToken(@Nullable String raw, int maxLength) {
    if (raw == null || raw.isBlank()) {
      return "";
    }
    var token = raw.strip().toUpperCase(Locale.ROOT);
    if (token.startsWith("MINECRAFT:")) {
      token = token.substring("MINECRAFT:".length());
    }
    token = NON_IDENTIFIER.matcher(token).replaceAll("_");
    while (token.startsWith("_")) {
      token = token.substring(1);
    }
    while (token.endsWith("_")) {
      token = token.substring(0, token.length() - 1);
    }
    return token.length() > maxLength ? token.substring(0, maxLength) : token;
  }
}
