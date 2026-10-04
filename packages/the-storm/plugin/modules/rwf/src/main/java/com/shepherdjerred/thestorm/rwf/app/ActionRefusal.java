package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;

/** Why a {@link CombatantActions} request did nothing. */
public enum ActionRefusal {
  /** The combatant is not in the match. */
  NOT_A_MEMBER,
  /** The combatant has no entity in the world (a bot not yet spawned, a player offline). */
  NO_ENTITY,
  /** The combatant is dead or the match is not live. */
  NOT_ALIVE,
  /** The match is not live. */
  NOT_LIVE,
  /** Kits are picked before the match starts. */
  NOT_PRE_GAME,
  /** There is no such kit. */
  UNKNOWN_KIT,
  /** There is no such bomb on this map. */
  UNKNOWN_BOMB,
  /** The bomb has exploded or been removed. */
  BOMB_DESTROYED,
  /** The combatant's team owns that bomb. */
  CANNOT_ARM_OWN_BOMB,
  /** The combatant's team did not arm that bomb. */
  CANNOT_DEFUSE_ENEMY_BOMB,
  /** A team cannot defuse the nuke it armed. */
  CANNOT_DEFUSE_OWN_NUKE,
  /** The bomb is further away than a player could reach. */
  BOMB_OUT_OF_REACH,
  /** The combatant no longer carries the Bomb Fuse. */
  NO_FUSE,
  /** The target is further away than a player could reach. */
  OUT_OF_REACH,
  /** A block is between the attacker and the target. */
  NO_LINE_OF_SIGHT,
  /** The target is on the attacker's own team. */
  SAME_TEAM,
  /** The target was hit too recently for a hit of that strength to land. */
  HIT_WINDOW,
  /** The combatant holds no bow, or has no arrows. */
  NO_BOW,
  /** The bow force must be between 0 and 1. */
  BAD_FORCE,
  /** The hotbar slot is empty or holds nothing edible the rules know. */
  NOTHING_TO_CONSUME,
  /** Within a point of full health, a steak is left uneaten. */
  FULL_HEALTH,
  /** The combatant does not carry the Time Machine. */
  NO_TIME_MACHINE,
  /** The Time Machine is cooling down. */
  COOLING_DOWN,
  /** The Time Machine has no landing spot yet. */
  NO_LANDING;

  /** The refusal for a match rule the request tripped. */
  public static ActionRefusal of(MatchError error) {
    return switch (error) {
      case NOT_A_MEMBER, ALREADY_JOINED, IN_PROGRESS, FULL -> NOT_A_MEMBER;
      case NOT_ALIVE -> NOT_ALIVE;
      case NOT_LIVE -> NOT_LIVE;
      case NOT_PRE_GAME, NO_MAP, MAP_LOCKED, TOO_FEW_PLAYERS -> NOT_PRE_GAME;
      case UNKNOWN_KIT -> UNKNOWN_KIT;
      case UNKNOWN_BOMB -> UNKNOWN_BOMB;
      case BOMB_DESTROYED -> BOMB_DESTROYED;
      case CANNOT_ARM_OWN_BOMB -> CANNOT_ARM_OWN_BOMB;
      case CANNOT_DEFUSE_ENEMY_BOMB -> CANNOT_DEFUSE_ENEMY_BOMB;
      case CANNOT_DEFUSE_OWN_NUKE -> CANNOT_DEFUSE_OWN_NUKE;
      case NOT_RESETTING, ALREADY_RESETTING -> NOT_LIVE;
    };
  }
}
