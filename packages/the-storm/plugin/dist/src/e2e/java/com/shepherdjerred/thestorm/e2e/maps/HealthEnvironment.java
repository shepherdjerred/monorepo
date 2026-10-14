package com.shepherdjerred.thestorm.e2e.maps;

import java.util.Map;
import org.bukkit.Difficulty;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Reversible controls for one disposable diagnostic; never changes health or healing rules. */
final class HealthEnvironment {
  private final Player body;
  private final World world;
  private final Difficulty originalDifficulty;
  private final int originalFood;
  private final float originalSaturation;
  private final HealthProtocol.Environment target;
  private boolean restored;

  HealthEnvironment(Player body, HealthProtocol.Environment target) {
    this.body = body;
    this.world = body.getWorld();
    this.originalDifficulty = world.getDifficulty();
    this.originalFood = body.getFoodLevel();
    this.originalSaturation = body.getSaturation();
    this.target = target;
  }

  void apply() {
    requireOriginalWorld();
    var health = body.getHealth();
    world.setDifficulty(Difficulty.valueOf(target.difficulty()));
    body.setFoodLevel(target.foodLevel());
    body.setSaturation((float) target.saturation());
    verify(
        Difficulty.valueOf(target.difficulty()), target.foodLevel(), (float) target.saturation());
    if (body.getHealth() != health)
      throw new IllegalStateException("environment setup changed health");
  }

  void restore() {
    if (restored) return;
    world.setDifficulty(originalDifficulty);
    requireOriginalWorld();
    var health = body.getHealth();
    body.setFoodLevel(originalFood);
    body.setSaturation(originalSaturation);
    verify(originalDifficulty, originalFood, originalSaturation);
    if (body.getHealth() != health)
      throw new IllegalStateException("environment restoration changed health");
    restored = true;
  }

  Map<String, String> evidence() {
    return Map.of(
        "difficulty", world.getDifficulty().name(),
        "foodLevel", Integer.toString(body.getFoodLevel()),
        "saturation", Float.toString(body.getSaturation()),
        "originalDifficulty", originalDifficulty.name(),
        "originalFoodLevel", Integer.toString(originalFood),
        "originalSaturation", Float.toString(originalSaturation),
        "directHealthChange", "false",
        "source", "explicit-controlled-diagnostic-environment");
  }

  private void requireOriginalWorld() {
    if (!body.getWorld().getUID().equals(world.getUID()))
      throw new IllegalStateException("controlled health subject left its original world");
  }

  private void verify(Difficulty difficulty, int food, float saturation) {
    if (world.getDifficulty() != difficulty
        || body.getFoodLevel() != food
        || body.getSaturation() != saturation)
      throw new IllegalStateException("controlled health environment read-back differs");
  }
}
