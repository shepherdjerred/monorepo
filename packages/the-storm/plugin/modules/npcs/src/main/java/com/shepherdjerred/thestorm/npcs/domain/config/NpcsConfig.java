package com.shepherdjerred.thestorm.npcs.domain.config;

import com.shepherdjerred.thestorm.npcs.domain.movement.MovementSettings;
import java.util.HashSet;
import java.util.List;

/**
 * {@code plugins/TheStorm/npcs.yml}, owned by the repository. The NPCs themselves are content under
 * {@code plugins/TheStorm/npcs/}.
 *
 * @param movement how NPCs walk
 * @param animation which NPCs move and how often they think
 * @param navigator Citizens path range
 * @param markers the quest markers above NPCs
 * @param dialog conversation settings
 * @param guard how NPCs detect threats and guards respond
 * @param warningPhrases shuffled warnings for the first two damaging player hits
 */
public record NpcsConfig(
    MovementSettings movement,
    Animation animation,
    Navigator navigator,
    Markers markers,
    Dialog dialog,
    Guard guard,
    List<String> warningPhrases) {

  public NpcsConfig {
    warningPhrases = List.copyOf(warningPhrases);
    if (warningPhrases.size() < 20
        || warningPhrases.size() > 30
        || new HashSet<>(warningPhrases).size() != warningPhrases.size()
        || warningPhrases.stream().anyMatch(phrase -> phrase.isBlank() || phrase.length() > 160)) {
      throw new IllegalArgumentException(
          "warningPhrases must contain 20..30 distinct short phrases");
    }
  }

  /** Detection follows each NPC; responding guards pursue within an incident's bounded area. */
  public record Guard(
      double detectionRadius,
      double responseRadius,
      double pursuitRadius,
      double attackReach,
      double damage,
      int cooldownTicks) {

    public Guard {
      if (!(detectionRadius >= 2 && detectionRadius <= 32)) {
        throw new IllegalArgumentException("guard detectionRadius must be 2..32");
      }
      if (!(responseRadius >= detectionRadius && responseRadius <= 128)) {
        throw new IllegalArgumentException("guard responseRadius must be detectionRadius..128");
      }
      if (!(pursuitRadius >= responseRadius && pursuitRadius <= 128)) {
        throw new IllegalArgumentException("guard pursuitRadius must be responseRadius..128");
      }
      if (!(attackReach >= 1 && attackReach <= 4)) {
        throw new IllegalArgumentException("guard attackReach must be 1..4");
      }
      if (!(damage > 0 && damage <= 10)) {
        throw new IllegalArgumentException("guard damage must be >0..10");
      }
      if (cooldownTicks < 5 || cooldownTicks > 100) {
        throw new IllegalArgumentException("guard cooldownTicks must be 5..100");
      }
    }
  }

  /**
   * Routine animation pauses without a player within {@code playerRadius}; threat reactions
   * continue in loaded chunks regardless of nearby players.
   *
   * @param playerRadius how close a player must be for an NPC to move
   * @param lookRadius how close a player must be for a resting NPC to turn and look at them
   * @param thinkIntervalTicks how often NPCs re-check their schedule and the weather
   */
  public record Animation(double playerRadius, double lookRadius, int thinkIntervalTicks) {

    public Animation {
      if (!(playerRadius >= 8 && playerRadius <= 128)) {
        throw new IllegalArgumentException("playerRadius must be 8..128: " + playerRadius);
      }
      if (!(lookRadius >= 0 && lookRadius <= playerRadius)) {
        throw new IllegalArgumentException("lookRadius must be 0..playerRadius: " + lookRadius);
      }
      if (thinkIntervalTicks < 1 || thinkIntervalTicks > 1200) {
        throw new IllegalArgumentException(
            "thinkIntervalTicks must be 1..1200: " + thinkIntervalTicks);
      }
    }
  }

  /**
   * Citizens navigation limits.
   *
   * @param followRange the longest path it will plan, in blocks; longer walks re-plan
   */
  public record Navigator(double followRange) {

    public Navigator {
      if (!(followRange >= 16 && followRange <= 128)) {
        throw new IllegalArgumentException("followRange must be 16..128: " + followRange);
      }
    }
  }

  /**
   * Quest markers.
   *
   * @param available shown when an NPC has a quest for the player
   * @param turnIn shown when the player can hand a quest in
   * @param height how far above the NPC's feet the marker floats
   */
  public record Markers(String available, String turnIn, double height) {

    public Markers {
      if (available.isBlank()
          || turnIn.isBlank()
          || available.length() > 8
          || turnIn.length() > 8) {
        throw new IllegalArgumentException("markers must be 1..8 characters");
      }
      if (!(height >= 1.8 && height <= 4)) {
        throw new IllegalArgumentException("marker height must be 1.8..4: " + height);
      }
    }
  }

  /**
   * Conversations.
   *
   * @param continueLabel the button on a node that continues with {@code next}
   * @param lifetimeMinutes how long a shown dialog's buttons keep working
   * @param holdSeconds how long an NPC stands still, facing the player, for a dialog of theirs that
   *     nobody answers; the server is not told when a dialog is closed with Escape
   * @param holdRadius how far the player may walk away before the NPC stops waiting
   */
  public record Dialog(
      String continueLabel, int lifetimeMinutes, int holdSeconds, double holdRadius) {

    public Dialog {
      if (continueLabel.isBlank() || continueLabel.length() > 32) {
        throw new IllegalArgumentException("continueLabel must be 1..32 characters");
      }
      if (lifetimeMinutes < 1 || lifetimeMinutes > 60) {
        throw new IllegalArgumentException("lifetimeMinutes must be 1..60: " + lifetimeMinutes);
      }
      if (holdSeconds < 1 || holdSeconds > 300) {
        throw new IllegalArgumentException("holdSeconds must be 1..300: " + holdSeconds);
      }
      if (!(holdRadius >= 2 && holdRadius <= 32)) {
        throw new IllegalArgumentException("holdRadius must be 2..32: " + holdRadius);
      }
    }
  }
}
