package com.shepherdjerred.thestorm.rwfbots.domain.world;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * The kits a combatant can play, as the bots understand them: a few traits that change how a bot
 * fights (a bow, golden apples, invisibility, the Rewind clock) and the kit items a bot knows how
 * to use, each with the moment it uses it ({@link #moves()}). Everything else about a kit (its
 * damage, its armour) is the server's business. rwf's kit list names the same kits, lower-case.
 *
 * <p>rwf may run kits bots have never heard of (a human on a newly added kit). Live match data is
 * read with {@link #closest}, which never fails; repo-owned configuration is read with {@link
 * #known} and refuses an unknown id.
 */
public enum Kit {
  /** Iron sword, three golden apples, iron armour. */
  TROOPER(Build.GAPPLES),
  /** Punch III bow, stone sword. */
  LONGBOW(Build.BOW),
  /** Power II bow, wooden sword with Knockback I. */
  SHORTBOW(Build.BOW),
  /** A clock that teleports back to where it was 30 s ago, 30 s cooldown. */
  REWIND(Build.REWIND),
  /** Invisible all match, hurts give it away. */
  GHOST(Build.INVISIBLE),
  /** Invisible archer whose arrow comes back. */
  WRAITH(Build.INVISIBLE_BOW),
  /** Appears to each enemy as one of their own teammates. */
  SPY(Build.NONE),
  /** Gains damage with every kill. */
  BERSERKER(Build.NONE),
  /** Lays landmines where it waits. */
  DEMOLITIONS(Build.NONE),
  /** Levels up by sneaking. */
  DWARF(Build.NONE),
  /** RPGs at range, grenades up close. */
  EXPLOSIVE(Build.NONE),
  /** Extra health, slow. */
  JUGGERNAUT(Build.NONE),
  /** Heals allies around it with its wand; eats golden apples. */
  MEDIC(Build.GAPPLES),
  /** A flaming bow. */
  PYRO(Build.BOW),
  /** Places a pair of teleporters. */
  TELEPORTER(Build.NONE),
  /** Steals health from kills. */
  VAMPIRE(Build.NONE),
  /** Poisons what it hits. */
  VENOM(Build.NONE),
  /** Sends enemies back to where it stood. */
  WARPER(Build.NONE),
  /** Fast and sneaky. */
  NINJA(Build.NONE),
  /** Freezes what it hits. */
  FROST(Build.NONE),
  /** Wears the skin of an enemy slain nearby. */
  SKINNER(Build.NONE),
  /** Makes its victims bleed. */
  BLEEDER(Build.NONE),
  /** Every hit does the same damage. */
  EQUALITY(Build.NONE),
  /** Builds momentum, blocks with a shield. */
  INERTIA(Build.NONE),
  /** Bonds with an ally to take its hurts. */
  SACRIFICIAL(Build.NONE),
  /** Defuses fast, shrugs off explosions. */
  SAPPER(Build.NONE),
  /** Arms fast and hides its progress. */
  SABOTEUR(Build.NONE),
  /** Makes enemies in sight glow for its team. */
  SPOTTER(Build.NONE),
  /** Pulls itself along with a hook. */
  GRAPPLER(Build.NONE),
  /** Plants a banner that heals allies around it. */
  BANNERMAN(Build.NONE),
  /** Throws up a barricade. */
  ENGINEER(Build.NONE),
  /** A crossbow, and its targets marked for the team. */
  TRACKER(Build.BOW),
  /** Leaves a running copy and slips away. */
  DECOY(Build.NONE),
  DUELIST(Build.NONE),
  KNIGHT(Build.NONE),
  RAVAGER(Build.GAPPLES),
  ACROBAT(Build.NONE),
  ALCHEMIST(Build.NONE),
  SCAVENGER(Build.NONE),
  ARBALIST(Build.BOW),
  VOLLEY(Build.BOW),
  MARKSMAN(Build.BOW),
  WINDRUNNER(Build.BOW),
  HARPOONER(Build.BOW),
  FLETCHER(Build.BOW),
  LANCER(Build.NONE),
  MACEGUARD(Build.NONE),
  QUARTERMASTER(Build.NONE),
  WARDEN(Build.NONE),
  SMOKESCREEN(Build.NONE),
  TACTICIAN(Build.NONE);

  /** The fighting traits a kit is built with. */
  private enum Build {
    NONE(false, false, false, false),
    BOW(true, false, false, false),
    GAPPLES(false, true, false, false),
    INVISIBLE(false, false, true, false),
    INVISIBLE_BOW(true, false, true, false),
    REWIND(false, false, false, true);

    private final boolean bow;
    private final boolean gapples;
    private final boolean invisible;
    private final boolean rewind;

    Build(boolean bow, boolean gapples, boolean invisible, boolean rewind) {
      this.bow = bow;
      this.gapples = gapples;
      this.invisible = invisible;
      this.rewind = rewind;
    }
  }

  private final Build build;

  Kit(Build build) {
    this.build = build;
  }

  /** rwf's id for this kit, lower-case, as kit content and match state name it. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The kit rwf names {@code id}, if bots know it. Ids are matched exactly, lower-case. */
  public static Optional<Kit> known(String id) {
    for (var kit : values()) {
      if (kit.id().equals(id)) {
        return Optional.of(kit);
      }
    }
    return Optional.empty();
  }

  /**
   * The kit rwf names {@code id}, or, when bots do not know it, the known kit that behaves most
   * like what can be {@code seen} of its wearer: an invisible wearer reads as {@link #GHOST}, one
   * carrying a bow as {@link #LONGBOW}, and anyone else as {@link #TROOPER}, the plain melee kit.
   * Only observable traits decide, because nothing else about an unknown kit is known; a disguise
   * cannot be seen, so no unknown kit reads as {@link #SPY}.
   */
  public static Kit closest(String id, Traits seen) {
    return known(id)
        .orElseGet(
            () -> {
              if (seen.invisible()) {
                return GHOST;
              }
              return seen.bow() ? LONGBOW : TROOPER;
            });
  }

  /**
   * What can be observed of a combatant without knowing their kit.
   *
   * @param bow whether they carry a bow or crossbow
   * @param invisible whether they are invisible
   */
  public record Traits(boolean bow, boolean invisible) {

    /** Nothing observed. */
    public static final Traits NONE = new Traits(false, false);
  }

  /** Whether the kit carries a bow or crossbow. */
  public boolean hasBow() {
    return build.bow;
  }

  /** Whether the kit's wearer is invisible by default. */
  public boolean isInvisibleKit() {
    return build.invisible;
  }

  /** Whether the kit has golden apples to eat. */
  public boolean hasGapples() {
    return build.gapples;
  }

  /** Whether the kit has a timed ability to trigger with {@link BodyCommand.UseAbility}. */
  public boolean hasAbility() {
    return build.rewind;
  }

  /** How a kit's body moves to feed a passive power, outside what its items do. */
  public enum Body {
    /** Nothing special. */
    PLAIN,
    /** Sneaks whenever it stands waiting with no enemy in sight: a Dwarf levels up so. */
    SNEAK_WHEN_IDLE,
    /**
     * Runs at a fight in a straight sprint, never strafing until in reach: an Inertia's momentum
     * dies when it turns or slows.
     */
    CHARGE
  }

  /** How this kit's body moves to feed its passive power. */
  public Body body() {
    return switch (this) {
      case DWARF -> Body.SNEAK_WHEN_IDLE;
      case INERTIA -> Body.CHARGE;
      default -> Body.PLAIN;
    };
  }

  /** The kit items a bot uses, and when; none for a kit whose power is passive. */
  public List<KitMove> moves() {
    return switch (this) {
      case KNIGHT, LANCER -> List.of(new KitMove("SHIELD", KitMove.Use.AT_ENEMY, 0, 6, 40));
      case ACROBAT -> List.of(new KitMove("FEATHER", KitMove.Use.TRAVEL, 3, 12, 160));
      case ALCHEMIST -> List.of(new KitMove("SPLASH_POTION", KitMove.Use.AT_ENEMY, 3, 14, 200));
      case WINDRUNNER, MACEGUARD ->
          List.of(new KitMove("WIND_CHARGE", KitMove.Use.TRAVEL, 5, 18, 100));
      case DEMOLITIONS ->
          List.of(new KitMove("STONE_PRESSURE_PLATE", KitMove.Use.PLACE, 20, 0, 100));
      case EXPLOSIVE ->
          List.of(
              new KitMove("EGG", KitMove.Use.AT_ENEMY, 8, 30, 100),
              new KitMove("FIREWORK_STAR", KitMove.Use.AT_ENEMY, 4, 14, 40));
      case MEDIC -> List.of(new KitMove("BLAZE_ROD", KitMove.Use.HEAL_ALLIES, 0, 6, 20));
      case TELEPORTER ->
          List.of(
              new KitMove("QUARTZ", KitMove.Use.PLACE, 25, 0, 200),
              new KitMove("MAP", KitMove.Use.FAR_ALLY, 25, 150, 600));
      case SACRIFICIAL ->
          List.of(
              new KitMove("RED_DYE", KitMove.Use.TOUCH_ALLY, 0, 3, 200),
              new KitMove("SHEARS", KitMove.Use.SELF_LOW, 0, 0, 400));
      case WARPER -> List.of(new KitMove("BLAZE_ROD", KitMove.Use.TOUCH_ENEMY, 0, 3.5, 100));
      case SPOTTER -> List.of(new KitMove("SPYGLASS", KitMove.Use.AT_ENEMY, 8, 60, 200));
      case GRAPPLER -> List.of(new KitMove("FISHING_ROD", KitMove.Use.TRAVEL, 12, 30, 100));
      case BANNERMAN -> List.of(new KitMove("WHITE_BANNER", KitMove.Use.AT_ENEMY, 0, 14, 300));
      case ENGINEER -> List.of(new KitMove("BRICKS", KitMove.Use.DEFEND, 0, 10, 200));
      case DECOY -> List.of(new KitMove("ARMOR_STAND", KitMove.Use.DEFEND, 0, 8, 300));
      default -> List.of();
    };
  }
}
