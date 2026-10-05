package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.Set;

/** Stable typed storage identifiers; malformed or retired identifiers fail at the boundary. */
public record TutorialKey(Topic topic, String variant) {
  public enum Topic {
    ENTRY,
    CLASSES,
    SPECIALIZATIONS,
    COMBAT,
    GATHERING,
    CRAFTING,
    ENCHANTING,
    BANKING,
    NODE_UPGRADES,
    PICKUPS,
    ENCOUNTERS,
    BOSS_MECHANICS,
    REVIVAL,
    ROUTES,
    DEFENSES,
    POWER,
    BOONS,
    BOX,
    RARITY,
    EQUIPMENT_EFFECTS,
    PLANE,
    AUGMENTATION,
    ENCOUNTER,
    BOSS,
    CAST,
    BOON,
    DROP,
    EQUIPMENT
  }

  public TutorialKey {
    java.util.Objects.requireNonNull(topic);
    java.util.Objects.requireNonNull(variant);
    switch (topic) {
      case ENCOUNTER -> EncounterDirector.Event.valueOf(variant);
      case BOSS -> {
        if (!Set.of(
                "gale-sovereign", "hexmaster", "ravager", "heartwood", "warden", "furnace-colossus")
            .contains(variant))
          throw new IllegalArgumentException("Unknown tutorial boss " + variant);
      }
      case CAST -> BossMechanics.Shape.valueOf(variant);
      case BOON -> SurvivalPerk.valueOf(variant);
      case DROP -> SurvivalDrop.valueOf(variant);
      case EQUIPMENT -> LegendaryWeapon.valueOf(variant);
      default -> {
        if (!variant.isEmpty())
          throw new IllegalArgumentException("Core tutorial cannot have a variant");
      }
    }
  }

  public static TutorialKey of(Topic topic) {
    return new TutorialKey(topic, "");
  }

  public String encode() {
    return topic.name() + ":" + variant;
  }

  public static TutorialKey decode(String id) {
    var parts = id.split(":", -1);
    if (parts.length != 2) throw new IllegalArgumentException("Invalid tutorial identifier " + id);
    return new TutorialKey(Topic.valueOf(parts[0]), parts[1]);
  }
}
