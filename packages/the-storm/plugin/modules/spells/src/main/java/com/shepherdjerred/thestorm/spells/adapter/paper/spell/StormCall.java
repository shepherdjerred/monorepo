package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.StormSky;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * Storm Call (IV): calls lightning down where the caster looks. Under a clear sky (or a roof, or in
 * a dry or snowy biome) it is only a flash and thunder. Where rain is falling it is real: it burns
 * and hurts the creatures the caster may harm and charges creepers. It never sets blocks alight:
 * the bolt is a visual effect, and the damage is the spell's own.
 */
final class StormCall implements Spell {

  private final SpellSettings.StormCall settings;
  private final Toolbox tools;

  StormCall(SpellSettings.StormCall settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.STORMCALL;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var strike = aim(caster);
    if (strike.isEmpty()) {
      return Result.err(CastProblem.noTarget("place in sight"));
    }
    var where = strike.get();
    if (!raining(where)) {
      return Result.ok(() -> flash(where));
    }
    var victims =
        tools
            .guard()
            .creatures(
                caster,
                tools.targets().around(caster, where, settings.radius()).stream()
                    .filter(caster::hasLineOfSight)
                    .toList());
    return Result.ok(
        () -> {
          flash(where);
          strike(caster, victims.allowed());
        });
  }

  private Optional<Location> aim(Player caster) {
    var creature = tools.targets().inSight(caster, settings.range());
    if (creature.isPresent()) {
      return Optional.of(creature.get().getLocation());
    }
    return tools
        .targets()
        .blockInSight(caster, settings.range())
        .map(hit -> hit.getHitPosition().toLocation(caster.getWorld()));
  }

  private static boolean raining(Location where) {
    var world = where.getWorld();
    var block = where.getBlock();
    var openSky = world.getHighestBlockYAt(block.getX(), block.getZ()) <= block.getY();
    return StormSky.rainsOn(world.hasStorm(), openSky, block.getTemperature());
  }

  private void flash(Location where) {
    where.getWorld().strikeLightningEffect(where);
    tools.fx().burst(kind(), where, 30, 1.0);
  }

  private void strike(Player caster, List<LivingEntity> victims) {
    var bolt =
        Harm.Blow.none()
            .withDamage(settings.damage())
            .withFire(Magic.ticks(settings.fireSeconds()))
            .then(
                victim -> {
                  if (victim instanceof Creeper creeper) {
                    creeper.setPowered(true);
                  }
                });
    victims.forEach(victim -> tools.harm().strike(caster, victim, bolt));
  }
}
