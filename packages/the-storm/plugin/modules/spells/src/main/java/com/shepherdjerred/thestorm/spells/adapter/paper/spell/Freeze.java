package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.adapter.paper.PaperNames;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Shapes;
import com.shepherdjerred.thestorm.spells.domain.temporary.Replaceability;
import java.time.Duration;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffectType;

/**
 * Freeze (III): frost locks up the creature in sight (powder-snow freezing and heavy slowness), and
 * still water around it turns to ice for a while where the caster may build. Ice never forms in a
 * block where any creature (the target included) or hanging entity is, so nobody is encased.
 */
final class Freeze implements Spell {

  private static final int SLOWNESS = 3;

  private final SpellSettings.Freeze settings;
  private final Toolbox tools;
  private final Material ice;

  Freeze(SpellSettings.Freeze settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
    this.ice =
        PaperNames.solid(settings.iceMaterial())
            .orElseThrow(
                () -> new IllegalStateException("freeze material " + settings.iceMaterial()));
  }

  @Override
  public SpellKind kind() {
    return SpellKind.FREEZE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var ticks = Magic.ticks(settings.durationSeconds());
    return Aim.creature(tools, caster, settings.range())
        .map(
            target -> {
              var water = iceable(caster, target);
              // Freeze ticks thaw by 2 a tick outside powder snow; this keeps the target fully
              // frozen (and taking frost damage) for the whole duration.
              var blow =
                  Harm.Blow.none()
                      .withFreeze(target.getMaxFreezeTicks() + 2 * ticks)
                      .withPotion(PotionEffectType.SLOWNESS, ticks, SLOWNESS)
                      .then(frozen -> iceOver(water));
              return () -> {
                if (tools.harm().strike(caster, target, blow)) {
                  tools.fx().line(kind(), caster.getEyeLocation(), Magic.chest(target));
                  tools.fx().cast(kind(), Magic.chest(target));
                }
              };
            });
  }

  private void iceOver(List<Block> water) {
    if (!water.isEmpty()) {
      tools
          .blocks()
          .place(water, ice.createBlockData(), Duration.ofSeconds(settings.durationSeconds()));
    }
  }

  /** Unoccupied still water near the target the caster may freeze; the rest is skipped. */
  private List<Block> iceable(Player caster, LivingEntity target) {
    if (settings.iceRadius() == 0) {
      return List.of();
    }
    var feet = Aim.pos(target.getLocation().getBlock());
    var candidates =
        Aim.blocks(target.getWorld(), Shapes.cylinder(feet, settings.iceRadius(), 1, 0));
    var eligible = tools.blocks().eligible(candidates, Replaceability.Mode.WATER);
    return tools.guard().blocks(caster, ProtectedAction.BUILD, eligible).allowed();
  }
}
