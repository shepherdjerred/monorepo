package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Difficulty;
import org.bukkit.GameRules;
import org.bukkit.attribute.Attribute;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityRegainHealthEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;

/**
 * A bot body's food tick, as vanilla runs it for every player. Citizens runs a player NPC's food
 * tick only under Minecraft AI, which bots go without so their own steering moves the body; without
 * it a bot never regenerated, and a bot left at half a heart with no golden apple held its slot for
 * minutes as no use to anyone. Rates and events are the server's own, so rwf's hunger rules apply
 * to bots as they do to humans.
 */
final class NaturalRegeneration {
  private static final float EXHAUSTION_STEP = 4;
  private static final float SATURATED_HEAL_LIMIT = 6;
  private static final float UNSATURATED_HEAL_COST = 6;

  private final Map<UUID, Integer> timers = new HashMap<>();

  /** One tick of {@code body}'s food: exhaustion, then healing or starving. */
  void tick(Player body) {
    exhaust(body);
    var timer = timers.getOrDefault(body.getUniqueId(), 0) + 1;
    timers.put(body.getUniqueId(), step(body, timer));
  }

  /** The food timer after this tick's healing or starving. */
  private static int step(Player body, int timer) {
    var regenerates =
        Boolean.TRUE.equals(
            body.getWorld().getGameRuleValue(GameRules.NATURAL_HEALTH_REGENERATION));
    var hurt = body.getHealth() > 0 && body.getHealth() < maxHealth(body);
    if (regenerates && hurt && body.getFoodLevel() >= 18) return regenerate(body, timer);
    if (body.getFoodLevel() <= 0) return starve(body, timer);
    return 0;
  }

  /** Saturation heals a full stomach fast; a merely fed one heals half a heart every 80 ticks. */
  private static int regenerate(Player body, int timer) {
    if (body.getSaturation() > 0 && body.getFoodLevel() >= 20) {
      if (timer < body.getSaturatedRegenRate()) return timer;
      var spent = Math.min(body.getSaturation(), SATURATED_HEAL_LIMIT);
      heal(body, spent / SATURATED_HEAL_LIMIT, spent);
      return 0;
    }
    if (timer < body.getUnsaturatedRegenRate()) return timer;
    heal(body, 1, UNSATURATED_HEAL_COST);
    return 0;
  }

  private static int starve(Player body, int timer) {
    if (timer < body.getStarvationRate()) return timer;
    if (starves(body)) body.damage(1, DamageSource.builder(DamageType.STARVE).build());
    return 0;
  }

  /** Forgets bodies that are no longer bots. */
  void retain(Set<UUID> present) {
    timers.keySet().retainAll(present);
  }

  private static void exhaust(Player body) {
    if (body.getExhaustion() <= EXHAUSTION_STEP) return;
    body.setExhaustion(body.getExhaustion() - EXHAUSTION_STEP);
    if (body.getSaturation() > 0) {
      body.setSaturation(Math.max(body.getSaturation() - 1, 0));
    } else if (body.getWorld().getDifficulty() != Difficulty.PEACEFUL) {
      var event = new FoodLevelChangeEvent(body, Math.max(body.getFoodLevel() - 1, 0), null);
      if (event.callEvent()) body.setFoodLevel(event.getFoodLevel());
    }
  }

  private static void heal(Player body, float amount, float exhaustion) {
    body.heal(amount, EntityRegainHealthEvent.RegainReason.SATIATED);
    body.setExhaustion(body.getExhaustion() + exhaustion);
  }

  private static boolean starves(Player body) {
    return switch (body.getWorld().getDifficulty()) {
      case HARD -> true;
      case NORMAL -> body.getHealth() > 1;
      default -> body.getHealth() > 10;
    };
  }

  private static double maxHealth(Player body) {
    var attribute = body.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) throw new IllegalStateException("players always have max health");
    return attribute.getValue();
  }
}
