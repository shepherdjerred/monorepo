package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Shapes;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * Dowse (I): puts out fires around the caster (where they may break blocks) and every burning
 * creature nearby, the caster included.
 */
final class Dowse implements Spell {

  private final SpellSettings.Radius settings;
  private final Toolbox tools;

  Dowse(SpellSettings.Radius settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.DOWSE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var centre = Magic.at(caster);
    var radius = (int) Math.ceil(settings.radius());
    var fires =
        Aim.blocks(caster.getWorld(), Shapes.ball(Aim.pos(centre.getBlock()), radius)).stream()
            .filter(block -> Tag.FIRE.isTagged(block.getType()))
            .toList();
    var screened = tools.guard().blocks(caster, ProtectedAction.BREAK, fires);
    List<LivingEntity> burning =
        centre.getWorld().getNearbyLivingEntities(centre, settings.radius()).stream()
            .filter(creature -> creature.getFireTicks() > 0)
            .toList();
    if (screened.isEmpty() && burning.isEmpty()) {
      return Result.err(CastProblem.nothingAllowed(screened, "fire nearby"));
    }
    List<Block> doused = screened.allowed();
    return Result.ok(
        () -> {
          doused.forEach(block -> block.setType(Material.AIR, false));
          burning.forEach(creature -> creature.setFireTicks(0));
          tools.fx().cast(kind(), centre);
          doused.forEach(
              block -> tools.fx().burst(kind(), block.getLocation().add(0.5, 0.5, 0.5), 6, 0.3));
        });
  }
}
