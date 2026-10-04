package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.Map;

/**
 * One bot as the think loop needs it for a match: who it is, which team and kit it plays, how well,
 * and in what style. Fixed for the match; the body and the snapshot carry everything that moves.
 *
 * @param id the bot's id in snapshots
 * @param slot the bot's roster slot, which staggers its think cycles
 * @param personalityId the personality driving it
 * @param team its team
 * @param kit its kit
 * @param levers its effective levers for this match
 * @param style its play style
 * @param roleWeights its role preferences
 */
public record BotProfile(
    CombatantId id,
    int slot,
    String personalityId,
    TeamId team,
    Kit kit,
    Levers levers,
    Style style,
    Map<Role, Double> roleWeights) {

  public BotProfile {
    if (slot < 0) {
      throw new IllegalArgumentException("slot must not be negative: " + slot);
    }
    if (personalityId.isBlank()) {
      throw new IllegalArgumentException("personality id must not be blank");
    }
    roleWeights = Map.copyOf(roleWeights);
    if (roleWeights.isEmpty()) {
      throw new IllegalArgumentException("a bot needs at least one role weight");
    }
  }
}
