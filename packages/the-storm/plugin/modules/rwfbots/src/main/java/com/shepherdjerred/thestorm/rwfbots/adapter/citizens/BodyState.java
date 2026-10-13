package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.bukkit.GameMode;
import org.bukkit.Registry;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.util.Vector;

/** The transient state a world transfer carries to the same NPC's replacement player. */
record BodyState(
    Gear gear,
    Vitals vitals,
    Flags flags,
    Flight flight,
    Motion motion,
    List<PotionEffect> effects,
    List<AttributeState> attributes,
    Scoreboard scoreboard) {

  static BodyState capture(Player player) {
    var attributes =
        Registry.ATTRIBUTE.stream()
            .flatMap(
                attribute ->
                    Optional.ofNullable(player.getAttribute(attribute))
                        .map(
                            instance ->
                                new AttributeState(
                                    attribute,
                                    instance.getBaseValue(),
                                    List.copyOf(instance.getModifiers())))
                        .stream())
            .toList();
    return new BodyState(
        Gear.capture(player),
        Vitals.capture(player),
        Flags.capture(player),
        Flight.capture(player),
        Motion.capture(player),
        List.copyOf(player.getActivePotionEffects()),
        attributes,
        player.getScoreboard());
  }

  void apply(Player player) {
    player.setGameMode(flags.gameMode());
    gear.apply(player);
    player.clearActivePotionEffects();
    player.addPotionEffects(effects);
    attributes.forEach(attribute -> attribute.apply(player));
    vitals.apply(player);
    flags.apply(player);
    flight.apply(player);
    motion.apply(player);
    player.setScoreboard(scoreboard);
  }

  record Gear(
      List<ItemStack> contents, int slot, int level, float experience, int totalExperience) {
    static Gear capture(Player player) {
      return new Gear(
          Arrays.stream(player.getInventory().getContents())
              .map(item -> item == null ? ItemStack.empty() : item.clone())
              .toList(),
          player.getInventory().getHeldItemSlot(),
          player.getLevel(),
          player.getExp(),
          player.getTotalExperience());
    }

    void apply(Player player) {
      player.getInventory().setContents(contents.toArray(ItemStack[]::new));
      player.getInventory().setHeldItemSlot(slot);
      player.setLevel(level);
      player.setExp(experience);
      player.setTotalExperience(totalExperience);
    }
  }

  record Vitals(
      double health,
      double absorption,
      int food,
      float saturation,
      float exhaustion,
      int fireTicks,
      int air,
      int noDamageTicks,
      double lastDamage) {
    static Vitals capture(Player player) {
      return new Vitals(
          player.getHealth(),
          player.getAbsorptionAmount(),
          player.getFoodLevel(),
          player.getSaturation(),
          player.getExhaustion(),
          player.getFireTicks(),
          player.getRemainingAir(),
          player.getNoDamageTicks(),
          player.getLastDamage());
    }

    void apply(Player player) {
      player.setHealth(health);
      player.setAbsorptionAmount(absorption);
      player.setFoodLevel(food);
      player.setSaturation(saturation);
      player.setExhaustion(exhaustion);
      player.setFireTicks(fireTicks);
      player.setRemainingAir(air);
      player.setNoDamageTicks(noDamageTicks);
      player.setLastDamage(lastDamage);
    }
  }

  record Flags(
      GameMode gameMode,
      boolean invulnerable,
      boolean collidable,
      boolean gravity,
      boolean invisible,
      boolean silent,
      boolean glowing,
      boolean sneaking,
      boolean sprinting) {
    static Flags capture(Player player) {
      return new Flags(
          player.getGameMode(),
          player.isInvulnerable(),
          player.isCollidable(),
          player.hasGravity(),
          player.isInvisible(),
          player.isSilent(),
          player.isGlowing(),
          player.isSneaking(),
          player.isSprinting());
    }

    void apply(Player player) {
      player.setInvulnerable(invulnerable);
      player.setCollidable(collidable);
      player.setGravity(gravity);
      player.setInvisible(invisible);
      player.setSilent(silent);
      player.setGlowing(glowing);
      player.setSneaking(sneaking);
      player.setSprinting(sprinting);
    }
  }

  record Flight(boolean allowed, boolean flying, float walkSpeed, float flySpeed) {
    static Flight capture(Player player) {
      return new Flight(
          player.getAllowFlight(), player.isFlying(), player.getWalkSpeed(), player.getFlySpeed());
    }

    void apply(Player player) {
      player.setAllowFlight(allowed);
      player.setFlying(flying);
      player.setWalkSpeed(walkSpeed);
      player.setFlySpeed(flySpeed);
    }
  }

  record Motion(Vector velocity, float fallDistance, int freezeTicks) {
    static Motion capture(Player player) {
      return new Motion(
          player.getVelocity().clone(), player.getFallDistance(), player.getFreezeTicks());
    }

    void apply(Player player) {
      player.setVelocity(velocity);
      player.setFallDistance(fallDistance);
      player.setFreezeTicks(freezeTicks);
    }
  }

  record AttributeState(Attribute attribute, double base, List<AttributeModifier> modifiers) {
    void apply(Player player) {
      var instance = player.getAttribute(attribute);
      if (instance == null) {
        player.registerAttribute(attribute);
        instance = player.getAttribute(attribute);
      }
      if (instance == null) {
        throw new IllegalStateException("could not register bot attribute " + attribute);
      }
      instance.setBaseValue(base);
      for (var modifier : instance.getModifiers()) {
        instance.removeModifier(modifier);
      }
      for (var modifier : modifiers) {
        instance.addModifier(modifier);
      }
    }
  }
}
