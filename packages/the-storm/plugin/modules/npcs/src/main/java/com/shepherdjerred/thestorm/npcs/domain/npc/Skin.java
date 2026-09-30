package com.shepherdjerred.thestorm.npcs.domain.npc;

import java.util.Locale;
import java.util.Set;

/** What an NPC looks like. Skins are baked into content; nothing is fetched at runtime. */
public sealed interface Skin {

  /** The Mannequin's own default look. */
  record Default() implements Skin {}

  /**
   * One of the game's built-in player skins, applied as a texture override. No signature needed,
   * but Bedrock players see a default skin.
   */
  record Vanilla(Model model, String name) implements Skin {

    /** The built-in player skins. */
    public static final Set<String> NAMES =
        Set.of("alex", "ari", "efe", "kai", "makena", "noor", "steve", "sunny", "zuri");

    public Vanilla {
      if (!NAMES.contains(name)) {
        throw new IllegalArgumentException("unknown built-in skin " + name + "; one of " + NAMES);
      }
    }

    /** The texture asset path, such as {@code entity/player/wide/steve}. */
    public String texturePath() {
      return "entity/player/" + model.id() + "/" + name;
    }
  }

  /**
   * A Mojang-signed {@code textures} profile property, copied once from the session server ({@code
   * ?unsigned=false}). Seen by Java and Bedrock players alike.
   */
  record Signed(String id, String value, String signature) implements Skin {

    public Signed {
      if (value.isBlank() || signature.isBlank()) {
        throw new IllegalArgumentException("skin " + id + " needs a value and a signature");
      }
    }
  }

  /** The player model's arm width. */
  enum Model {
    WIDE,
    SLIM;

    public String id() {
      return name().toLowerCase(Locale.ROOT);
    }
  }

  /** A short, stable description used for change detection and admin output. */
  default String describe() {
    return switch (this) {
      case Default() -> "none";
      case Vanilla(var model, var name) -> "vanilla:" + model.id() + "/" + name;
      case Signed(var id, var value, var signature) ->
          id + "#" + Integer.toHexString((value + signature).hashCode());
    };
  }
}
