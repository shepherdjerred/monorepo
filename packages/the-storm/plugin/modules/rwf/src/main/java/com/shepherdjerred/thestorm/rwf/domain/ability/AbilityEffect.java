package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.RewindTrail;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** What the server must do because an ability fired. The Paper adapter carries these out. */
public sealed interface AbilityEffect {

  /** Effectively forever, for potion lengths. */
  int FOREVER = Integer.MAX_VALUE;

  /**
   * Give a potion effect in place of any of its kind, with its particles showing, as Red Warfare's
   * {@code addPotionEffect(effect, true)} and {@code ConditionManager.addPotion(..., false)} did.
   *
   * @param id who
   * @param effect the effect's key, such as {@code poison}
   * @param amplifier 0 for level I
   * @param ticks how long; {@link #FOREVER} for the rest of the match
   * @param by who gave it, so its damage is credited to them
   */
  record Potion(CombatantId id, String effect, int amplifier, int ticks, Optional<CombatantId> by)
      implements AbilityEffect {}

  /**
   * Give a potion effect on top of any of its kind, as Red Warfare's {@code
   * ConditionManager.addPotion(..., true)} did: the new length adds to what is left of the old one
   * and the stronger level is kept.
   *
   * @param id who
   * @param effect the effect's key, such as {@code poison}
   * @param amplifier 0 for level I
   * @param ticks how long it adds
   * @param by who gave it, so its damage is credited to them
   */
  record PotionStack(
      CombatantId id, String effect, int amplifier, int ticks, Optional<CombatantId> by)
      implements AbilityEffect {}

  /**
   * Give a potion effect whose swirl shows, as it did for every potion Red Warfare gave through a
   * plain {@code new PotionEffect(type, ticks, amplifier)}; credited to nobody.
   *
   * @param id who
   * @param effect the effect's key, such as {@code slowness}
   * @param amplifier 0 for level I
   * @param ticks how long
   */
  record SwirlingPotion(CombatantId id, String effect, int amplifier, int ticks)
      implements AbilityEffect {}

  /** Take a potion effect away. */
  record ClearPotion(CombatantId id, String effect) implements AbilityEffect {}

  /**
   * Set max health.
   *
   * @param id who
   * @param max the new max health
   * @param fill whether to heal them to it
   */
  record MaxHealth(CombatantId id, double max, boolean fill) implements AbilityEffect {}

  /** Heal, never past max health. */
  record Heal(CombatantId id, double amount) implements AbilityEffect {}

  /**
   * Deal damage the rules computed, through the combat rules' armor and hit window.
   *
   * @param id who
   * @param amount how much
   * @param cause how
   * @param by who is credited
   */
  record Damage(CombatantId id, double amount, AttackType cause, Optional<CombatantId> by)
      implements AbilityEffect {}

  /**
   * An ability went on cooldown: the experience bar refills over {@code length}.
   *
   * @param id who
   * @param ability which cooldown, for the bar's owner to tell apart
   * @param length how long until it is ready
   */
  record Cooldown(CombatantId id, String ability, Duration length) implements AbilityEffect {}

  /**
   * Show a level and a bar fill on the experience bar, as the Dwarf and Sacrificial did.
   *
   * @param id who
   * @param level the level number
   * @param progress the bar, 0 to 1
   */
  record Meter(CombatantId id, int level, float progress) implements AbilityEffect {}

  /**
   * Set the enchantments a Dwarf's level grants: Sharpness on weapons, Protection and Blast
   * Protection on armour; 0 removes one.
   */
  record Gear(CombatantId id, int sharpness, int protection, int blastProtection)
      implements AbilityEffect {}

  /** Freeze or thaw a combatant's hands: no slot switches, no offhand, no inventory clicks. */
  record Hands(CombatantId id, boolean frozen) implements AbilityEffect {}

  /**
   * Move a combatant.
   *
   * @param id who
   * @param to where
   * @param by who sent them, credited with a fall that follows
   */
  record Teleport(CombatantId id, Vec3 to, Optional<CombatantId> by) implements AbilityEffect {}

  /**
   * Send a Rewind back along its trail, as Red Warfare's Time Machine did: its message, the
   * enderman sound and ender signal where it leaves and where it lands, out of any vehicle, facing
   * the way it faced there, stopped, with fire and fall distance cleared and nobody credited for a
   * later fall.
   *
   * @param id who
   * @param to where they land and which way they face
   */
  record TimeTravel(CombatantId id, RewindTrail.Spot to) implements AbilityEffect {}

  /**
   * A combatant used their kit's ability: an active use the kit answered with more than a refusal.
   * Counted toward their ability uses and recorded.
   *
   * @param id who
   * @param ability the ability's id
   * @param target who it was used on, if anyone
   */
  record Used(CombatantId id, String ability, Optional<CombatantId> target)
      implements AbilityEffect {}

  /**
   * Move a combatant as Red Warfare's {@code UtilPlayer.tele} did: out of any vehicle, onto a spot
   * nudged off anyone already standing there, facing the way the spot was faced.
   *
   * @param id who
   * @param to where
   * @param yaw which way to face, in degrees
   * @param pitch how far up or down to look, in degrees
   * @param by who sent them, credited with a fall that follows, as Red Warfare's {@code
   *     ConditionManager.addFall}
   */
  record Send(CombatantId id, Vec3 to, float yaw, float pitch, Optional<CombatantId> by)
      implements AbilityEffect {}

  /**
   * Lift a combatant {@code up} blocks where they stand and set them moving up at {@code up} blocks
   * a tick, as the Juggernaut's start.
   *
   * @param id who
   * @param up how far, and how fast
   */
  record Hop(CombatantId id, double up) implements AbilityEffect {}

  /** Add {@code velocity} to a combatant's motion. */
  record Push(CombatantId id, Vec3 velocity) implements AbilityEffect {}

  /** A cooldown on the server's fall damage for this combatant, as the Grappler's landing. */
  record NoFall(CombatantId id, Duration length) implements AbilityEffect {}

  /**
   * Tell combatants something, in the colour Red Warfare used.
   *
   * @param to who
   * @param text what; Red Warfare's section-sign colour codes in it (see {@link KitText}) colour
   *     the text that follows them, as they did
   * @param tone the colour of any text before the first code
   */
  record Say(List<CombatantId> to, String text, Tone tone) implements AbilityEffect {

    public Say {
      to = List.copyOf(to);
    }
  }

  /** A sound and particles for something a kit did. */
  record Cue(CombatantId at, KitCue cue) implements AbilityEffect {}

  /** A sound and particles at a block. */
  record CueAt(BlockPos at, KitCue cue) implements AbilityEffect {}

  /**
   * A sound only {@code to} hears, played where {@code at} stands, as Red Warfare's {@code
   * player.playSound}.
   *
   * @param to who hears it
   * @param at where it plays
   * @param cue which sound
   */
  record Hear(CombatantId to, CombatantId at, KitCue cue) implements AbilityEffect {}

  /**
   * Place a block the match owns; every one is put back at reset.
   *
   * @param at where
   * @param material what, such as {@code STONE_PRESSURE_PLATE}
   */
  record PlaceBlock(BlockPos at, String material) implements AbilityEffect {}

  /** Put back what stood at {@code at} before the match placed a block there. */
  record ClearBlock(BlockPos at) implements AbilityEffect {}

  /**
   * An explosion that hurts combatants but never blocks.
   *
   * @param at its centre
   * @param power its size, as a vanilla explosion's
   * @param maxDamage the most it deals anyone
   * @param owner who set it off, credited with its kills
   * @param cause how it kills others
   * @param selfCause how it kills its owner
   * @param selfExtra damage added when it catches its owner
   */
  record Explode(
      Vec3 at,
      float power,
      double maxDamage,
      CombatantId owner,
      AttackType cause,
      AttackType selfCause,
      double selfExtra)
      implements AbilityEffect {}

  /** Launch a projectile from a combatant, along where they look. */
  record Launch(CombatantId id, Projectile projectile) implements AbilityEffect {}

  /**
   * Give an item while they hold fewer than {@code cap} of its material.
   *
   * @param id who
   * @param item what
   * @param cap the most they may hold
   */
  record Give(CombatantId id, ItemSpec item, int cap) implements AbilityEffect {}

  /** Put {@code item} in inventory slot {@code slot}. */
  record SetSlot(CombatantId id, int slot, ItemSpec item) implements AbilityEffect {}

  /** Take up to {@code amount} of {@code material}. */
  record Take(CombatantId id, String material, int amount) implements AbilityEffect {}

  /**
   * One arrow stuck in a Ghost falls out, ten seconds after it hit. Once a ghost has none left, the
   * arrows still due to fall out of it that hit it before then are forgotten, as Red Warfare forgot
   * them.
   *
   * @param id the ghost
   * @param hit when the arrow hit
   */
  record Unstick(CombatantId id, Instant hit) implements AbilityEffect {}

  /**
   * Remember how {@code victim} looks now (their skin and armour), for a Skinner who may wear it.
   *
   * @param skinner who will wear it
   * @param victim whose
   */
  record SnapSkin(CombatantId skinner, CombatantId victim) implements AbilityEffect {}

  /**
   * Wear the skin and armour remembered of {@code of} before the enemy, or none to look like
   * oneself again.
   *
   * @param id the Skinner
   * @param of whose skin, as remembered by {@link SnapSkin}
   */
  record Skin(CombatantId id, Optional<CombatantId> of) implements AbilityEffect {}

  /** How visible a combatant is. */
  record Visibility(CombatantId id, Seen seen) implements AbilityEffect {}

  /**
   * How a combatant looks to everyone but their team.
   *
   * @param id who
   * @param disguise the disguise, or none to look like themselves
   */
  record Disguise(CombatantId id, Optional<Disguised> disguise) implements AbilityEffect {}

  /**
   * Make {@code target} glow for {@code team} only.
   *
   * @param target who glows
   * @param team who sees it
   * @param length for how long
   */
  record Glow(CombatantId target, TeamColor team, Duration length) implements AbilityEffect {}

  /**
   * Point {@code team}'s compasses at {@code target}.
   *
   * @param target who
   * @param team whose compasses
   */
  record Mark(CombatantId target, TeamColor team) implements AbilityEffect {}

  /**
   * Send a running copy of a combatant.
   *
   * @param id whose copy
   * @param direction where it runs
   * @param length for how long
   */
  record Decoy(CombatantId id, Vec3 direction, Duration length) implements AbilityEffect {}

  /** How a message reads. */
  enum Tone {
    /** Red Warfare's blue and gold notices. */
    INFO,
    /** A refusal, in red. */
    REFUSED,
    /** Good news, in green. */
    GOOD,
    /**
     * Red Warfare's own text, its colours and formats written in with section-sign codes such as
     * {@code §3}, sent exactly as it was.
     */
    LEGACY,
  }

  /** What a kit launches. */
  enum Projectile {
    /** The Explosive's RPG: flies straight until it hits, then explodes. */
    RPG,
    /** The Explosive's grenade: thrown, explodes three seconds later. */
    GRENADE,
  }

  /** How visible a combatant is. */
  enum Seen {
    /** As anyone. */
    VISIBLE,
    /** Invisible, as Ghost and Wraith: held items, particles and arrows still show. */
    GHOST,
    /** Hidden from the enemy altogether, as a Decoy's owner. */
    HIDDEN,
  }

  /**
   * A disguise.
   *
   * @param name the name the enemy sees
   * @param team the team colour the enemy sees, or empty for each viewer's own team (the Spy)
   */
  record Disguised(String name, Optional<TeamColor> team) {}
}
