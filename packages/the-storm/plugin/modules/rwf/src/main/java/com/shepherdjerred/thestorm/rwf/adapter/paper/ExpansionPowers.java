package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Duelist;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Knight;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Marksman;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ravager;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.ExpansionKits;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.Player;
import org.bukkit.entity.ThrownPotion;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.event.entity.PotionSplashEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/** Native item operations, shot facts and private salvage for the classic/ranged expansion. */
final class ExpansionPowers {
  private static final NamespacedKey SHOT_X = new NamespacedKey("thestorm", "rwf_shot_x");
  private static final NamespacedKey SHOT_Y = new NamespacedKey("thestorm", "rwf_shot_y");
  private static final NamespacedKey SHOT_Z = new NamespacedKey("thestorm", "rwf_shot_z");
  private static final NamespacedKey DRAWN = new NamespacedKey("thestorm", "rwf_shot_drawn");

  private record Loot(CombatantId owner, CombatantId victim) {}

  private final MatchRunner runner;
  private final PaperContext context;
  private final Keys keys;
  private final KitFactory factory;
  private final Map<Loot, ItemDisplay> salvage = new HashMap<>();
  private final Map<UUID, CombatantId> flasks = new HashMap<>();

  ExpansionPowers(MatchRunner runner, PaperContext context, Keys keys, KitFactory factory) {
    this.runner = runner;
    this.context = context;
    this.keys = keys;
    this.factory = factory;
  }

  void apply(ExpansionEffect effect) {
    switch (effect) {
      case ExpansionEffect.DisableShield disable ->
          runner
              .entity(disable.victim())
              .ifPresent(
                  player -> {
                    player.clearActiveItem();
                    player.setCooldown(Material.SHIELD, disable.ticks());
                  });
      case ExpansionEffect.Flask flask ->
          runner
              .entity(flask.owner())
              .ifPresent(
                  player -> {
                    var potion = player.launchProjectile(ThrownPotion.class);
                    potion.setItem(
                        factory.kitItem(ExpansionKits.ALCHEMIST.hotbar().get(1).times(1)));
                    keys.tagKitEntity(potion);
                    flasks.put(potion.getUniqueId(), flask.owner());
                  });
      case ExpansionEffect.Salvage drop -> {
        var display =
            context
                .mapWorld()
                .spawn(
                    Places.location(context.mapWorld(), drop.at().plus(new Vec3(0, 0.3, 0))),
                    ItemDisplay.class);
        display.setItemStack(new ItemStack(Material.RAW_IRON));
        display.setVisibleByDefault(false);
        keys.tagKitEntity(display);
        salvage.put(new Loot(drop.owner(), drop.victim()), display);
        runner.entity(drop.owner()).ifPresent(owner -> owner.showEntity(context.plugin(), display));
      }
      case ExpansionEffect.ClearSalvage clear -> {
        var display = salvage.remove(new Loot(clear.owner(), clear.victim()));
        if (display != null) display.remove();
      }
    }
  }

  void meleeFacts(Player attacker, Player victim) {
    var kit = runner.memberOf(attacker.getUniqueId()).flatMap(member -> member.kit()).orElse("");
    if (!kit.equals(Duelist.ID) && !kit.equals(Knight.ID)) return;
    var at = Places.at(victim);
    var isolated =
        runner.match().members().stream()
            .filter(member -> member.alive())
            .filter(
                member ->
                    !member.id().uuid().equals(attacker.getUniqueId())
                        && !member.id().uuid().equals(victim.getUniqueId()))
            .map(member -> runner.entity(member.id()))
            .flatMap(java.util.Optional::stream)
            .noneMatch(
                other ->
                    other.getWorld().equals(victim.getWorld())
                        && Places.at(other).distance(at) <= Duelist.RADIUS);
    runner
        .kits()
        .act(attacker, new ExpansionInput.StrikeFacts(AttackType.MELEE, isolated, 0, false));
  }

  void projectileFacts(CombatListener.Strike strike) {
    if (!runner
        .memberOf(strike.attacker().getUniqueId())
        .flatMap(member -> member.kit())
        .filter(Marksman.ID::equals)
        .isPresent()) return;
    var data = strike.source().getPersistentDataContainer();
    var x = data.get(SHOT_X, PersistentDataType.DOUBLE);
    var y = data.get(SHOT_Y, PersistentDataType.DOUBLE);
    var z = data.get(SHOT_Z, PersistentDataType.DOUBLE);
    var drawn = data.get(DRAWN, PersistentDataType.BOOLEAN);
    var distance =
        x == null || y == null || z == null
            ? 0
            : new Vec3(x, y, z).distanceTo(Places.vec(Places.at(strike.victim())));
    runner
        .kits()
        .act(
            strike.attacker(),
            new ExpansionInput.StrikeFacts(
                strike.type(), false, distance, Boolean.TRUE.equals(drawn)));
  }

  void shot(EntityShootBowEvent event) {
    if (!(event.getEntity() instanceof Player player) || !runner.fighting(player.getUniqueId()))
      return;
    if (runner
        .memberOf(player.getUniqueId())
        .flatMap(member -> member.kit())
        .filter(Marksman.ID::equals)
        .isEmpty()) return;
    var at = player.getEyeLocation();
    var data = event.getProjectile().getPersistentDataContainer();
    data.set(SHOT_X, PersistentDataType.DOUBLE, at.getX());
    data.set(SHOT_Y, PersistentDataType.DOUBLE, at.getY());
    data.set(SHOT_Z, PersistentDataType.DOUBLE, at.getZ());
    data.set(DRAWN, PersistentDataType.BOOLEAN, event.getForce() >= 0.999f);
  }

  /** Returns true when a new shield kit or Ravager owns this block's rules. */
  boolean shield(CombatListener.Strike strike) {
    var victim = strike.victim();
    var defending =
        runner.memberOf(victim.getUniqueId()).flatMap(member -> member.kit()).orElse("");
    if (defending.equals(Knight.ID))
      runner.kits().act(victim, new ExpansionInput.ShieldBlock(victim.getActiveItemUsedTime()));
    var ravager =
        runner
                .memberOf(strike.attacker().getUniqueId())
                .flatMap(member -> member.kit())
                .filter(Ravager.ID::equals)
                .isPresent()
            && strike.type().has(AttackType.Flag.MELEE)
            && strike
                .attacker()
                .getInventory()
                .getItemInMainHand()
                .getType()
                .name()
                .endsWith("_AXE");
    if (ravager)
      runner
          .memberOf(victim.getUniqueId())
          .ifPresent(
              member ->
                  runner
                      .kits()
                      .act(strike.attacker(), new ExpansionInput.ShieldContact(member.id())));
    return ravager || defending.equals(Knight.ID) || defending.equals("lancer");
  }

  void splash(PotionSplashEvent event) {
    var owner = flasks.remove(event.getPotion().getUniqueId());
    if (owner == null) return;
    event.setCancelled(true);
    var at = Places.at(event.getPotion());
    var targets =
        runner.match().members().stream()
            .filter(member -> member.alive())
            .filter(
                member ->
                    runner
                        .entity(member.id())
                        .filter(
                            player ->
                                player.getWorld().equals(at.getWorld())
                                    && Places.at(player).distance(at) <= 3)
                        .isPresent())
            .map(member -> member.id())
            .toList();
    runner.kits().act(owner, new ExpansionInput.FlaskSplash(targets));
  }

  void reset() {
    salvage.values().forEach(Entity::remove);
    salvage.clear();
    for (var id : flasks.keySet()) {
      var entity = context.server().getEntity(id);
      if (entity != null) entity.remove();
    }
    flasks.clear();
  }
}
