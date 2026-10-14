package com.shepherdjerred.thestorm.rwf.app;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/** Authored gameplay preferences. Overrides live in memory and are copied once at draft time. */
public record ExperienceSettings(
    Difficulty difficulty, Style style, Variety variety, Set<String> maps, Set<String> kits) {

  public static final ExperienceSettings DEFAULT = Preset.CHALLENGING.settings();

  public ExperienceSettings {
    Objects.requireNonNull(difficulty);
    Objects.requireNonNull(style);
    Objects.requireNonNull(variety);
    maps = ids(maps);
    kits = ids(kits);
  }

  /** Empty restrictions mean every admitted map and every otherwise available kit. */
  private static Set<String> ids(Set<String> values) {
    for (var value : values) {
      if (!value.matches("[a-z0-9]+(?:-[a-z0-9]+)*")) {
        throw new IllegalArgumentException("invalid content id: " + value);
      }
    }
    return Set.copyOf(values);
  }

  public enum Difficulty {
    @JsonProperty("easy")
    EASY(0.42, 0.30),
    @JsonProperty("normal")
    NORMAL(0.64, 0.46),
    @JsonProperty("hard")
    HARD(0.84, 0.62);

    private final double skill;
    private final double floor;

    Difficulty(double skill, double floor) {
      this.skill = skill;
      this.floor = floor;
    }

    public double skill() {
      return skill;
    }

    public double competenceFloor() {
      return floor;
    }
  }

  public enum Style {
    @JsonProperty("varied")
    VARIED,
    @JsonProperty("push")
    PUSH,
    @JsonProperty("cautious")
    CAUTIOUS,
    @JsonProperty("teamplay")
    TEAMPLAY
  }

  public enum Variety {
    @JsonProperty("low")
    LOW(0.025),
    @JsonProperty("medium")
    MEDIUM(0.06),
    @JsonProperty("high")
    HIGH(0.10);

    private final double spread;

    Variety(double spread) {
      this.spread = spread;
    }

    public double spread() {
      return spread;
    }
  }

  public enum Preset {
    RELAXED(Difficulty.EASY, Style.VARIED, Variety.MEDIUM),
    BALANCED(Difficulty.NORMAL, Style.TEAMPLAY, Variety.MEDIUM),
    CHALLENGING(Difficulty.HARD, Style.VARIED, Variety.HIGH);

    private final Difficulty difficulty;
    private final Style style;
    private final Variety variety;

    Preset(Difficulty difficulty, Style style, Variety variety) {
      this.difficulty = difficulty;
      this.style = style;
      this.variety = variety;
    }

    public ExperienceSettings settings() {
      return new ExperienceSettings(difficulty, style, variety, Set.of(), Set.of());
    }
  }

  public ExperienceSettings withDifficulty(Difficulty value) {
    return new ExperienceSettings(value, style, variety, maps, kits);
  }

  public ExperienceSettings withStyle(Style value) {
    return new ExperienceSettings(difficulty, value, variety, maps, kits);
  }

  public ExperienceSettings withVariety(Variety value) {
    return new ExperienceSettings(difficulty, style, value, maps, kits);
  }

  public ExperienceSettings withMaps(Set<String> value) {
    return new ExperienceSettings(difficulty, style, variety, value, kits);
  }

  public ExperienceSettings withKits(Set<String> value) {
    return new ExperienceSettings(difficulty, style, variety, maps, value);
  }

  /** Stable locale-independent wire form, including the seed that freezes match variety. */
  public String canonical(long seed) {
    return "experience-v1;seed=" + seed + ";" + description();
  }

  public String description() {
    return "difficulty="
        + difficulty.name().toLowerCase(Locale.ROOT)
        + ";style="
        + style.name().toLowerCase(Locale.ROOT)
        + ";variety="
        + variety.name().toLowerCase(Locale.ROOT)
        + ";maps="
        + String.join(",", new TreeSet<>(maps))
        + ";kits="
        + String.join(",", new TreeSet<>(kits));
  }

  public String fingerprint(long seed) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(canonical(seed).getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("JDK has no SHA-256", impossible);
    }
  }
}
