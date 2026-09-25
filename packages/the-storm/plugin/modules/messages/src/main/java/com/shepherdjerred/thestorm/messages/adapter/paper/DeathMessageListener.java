package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.messages.domain.DeathCatalog;
import com.shepherdjerred.thestorm.messages.domain.DeathCause;
import com.shepherdjerred.thestorm.messages.domain.DeathSpamLimiter;
import com.shepherdjerred.thestorm.messages.domain.Killer;
import com.shepherdjerred.thestorm.messages.domain.Placeholder;
import com.shepherdjerred.thestorm.messages.domain.Template;
import java.time.InstantSource;
import java.util.EnumMap;
import java.util.Map;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;

/**
 * Replaces vanilla death messages with the catalog's. When the spam limiter hides a death, nobody
 * else hears about it, but the player still reads the joke on their death screen.
 */
public final class DeathMessageListener implements Listener {

  private final DeathCatalog catalog;
  private final Component unarmed;
  private final RandomGenerator random;
  private final InstantSource time;
  private DeathSpamLimiter limiter;

  public DeathMessageListener(
      DeathCatalog catalog, Component unarmed, DeathSpamLimiter limiter, Sources sources) {
    this.catalog = catalog;
    this.unarmed = unarmed;
    this.limiter = limiter;
    this.random = sources.random();
    this.time = sources.time();
  }

  /**
   * Time and randomness for the listener.
   *
   * @param random picks templates
   * @param time timestamps deaths for the spam limiter
   */
  public record Sources(RandomGenerator random, InstantSource time) {}

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onDeath(PlayerDeathEvent event) {
    var victim = event.getPlayer();
    var source = event.getDamageSource();
    var names = new EnumMap<Placeholder, Component>(Placeholder.class);
    names.put(Placeholder.PLAYER, victim.name());
    var killer = killer(victim, source, names);
    var message = render(catalog.pick(cause(source), killer, random), names);

    var verdict = limiter.record(victim.getUniqueId(), time.instant());
    limiter = verdict.next();
    if (verdict.announce()) {
      event.deathMessage(message);
    } else {
      event.deathMessage(null);
      event.deathScreenMessageOverride(message);
    }
  }

  private static DeathCause cause(DamageSource source) {
    var key = source.getDamageType().key().asString();
    return DeathCause.fromDamageType(key)
        .orElseThrow(
            () -> new IllegalStateException("damage type " + key + " was not checked at enable"));
  }

  private Killer killer(Player victim, DamageSource source, Map<Placeholder, Component> names) {
    var causing = source.getCausingEntity();
    if (causing instanceof Player player) {
      if (player.getUniqueId().equals(victim.getUniqueId())) {
        return new Killer.None();
      }
      names.put(Placeholder.KILLER, player.name());
      var held = player.getInventory().getItemInMainHand();
      names.put(Placeholder.WEAPON, held.isEmpty() ? unarmed : held.effectiveName());
      return new Killer.Player();
    }
    if (causing instanceof LivingEntity mob) {
      names.put(Placeholder.KILLER, mob.name());
      return new Killer.Mob(mob.getType().key().value());
    }
    return new Killer.None();
  }

  private static Component render(Template template, Map<Placeholder, Component> names) {
    var parts =
        template.fill(
            placeholder -> name(names, placeholder).colorIfAbsent(HouseStyle.BRAND),
            Component::text);
    return Component.text().color(NamedTextColor.GRAY).append(parts).build();
  }

  private static Component name(Map<Placeholder, Component> names, Placeholder placeholder) {
    var name = names.get(placeholder);
    if (name == null) {
      throw new IllegalStateException(
          "the catalog allowed " + placeholder.token() + " where no name exists");
    }
    return name;
  }
}
