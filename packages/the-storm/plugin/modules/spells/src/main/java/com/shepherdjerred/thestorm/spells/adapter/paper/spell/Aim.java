package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.spells.domain.temporary.Replaceability;
import java.util.List;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;

/** Targeting shared by spells: find, then screen through protection, then refuse or proceed. */
final class Aim {

  private Aim() {}

  /** The creature in sight, if the caster's spell may affect it. */
  static Result<LivingEntity, CastProblem> creature(Toolbox tools, Player caster, double range) {
    var target = tools.targets().inSight(caster, range);
    if (target.isEmpty()) {
      return Result.err(CastProblem.noTarget("creature in sight"));
    }
    var creature = target.get();
    return tools
        .guard()
        .harmDenial(caster, creature)
        .<Result<LivingEntity, CastProblem>>map(
            reason -> Result.err(new CastProblem.Protected(reason)))
        .orElseGet(() -> Result.ok(creature));
  }

  /** Every creature around the caster the spell may affect; refuses when there are none. */
  static Result<List<LivingEntity>, CastProblem> creaturesAround(
      Toolbox tools, Player caster, double radius) {
    var screened = tools.guard().creatures(caster, tools.targets().inView(caster, radius));
    return screened.isEmpty()
        ? Result.err(CastProblem.nothingAllowed(screened, "creature nearby"))
        : Result.ok(screened.allowed());
  }

  /**
   * The hostile monsters the caster can see around them, leaving out those on land where the caster
   * may not build; refuses (naming {@code what}) when there are none.
   */
  static Result<List<Mob>, CastProblem> hostiles(
      Toolbox tools, Player caster, double radius, String what) {
    var screened = tools.guard().creatures(caster, tools.targets().hostilesInView(caster, radius));
    return screened.isEmpty()
        ? Result.err(CastProblem.nothingAllowed(screened, what))
        : Result.ok(screened.allowed());
  }

  /**
   * The blocks among {@code candidates} a temporary block may replace in {@code mode} and the
   * caster may build on; refuses when there are none.
   */
  static Result<List<Block>, CastProblem> buildable(
      Toolbox tools, Player caster, List<Block> candidates, Replaceability.Mode mode) {
    var eligible = tools.blocks().eligible(candidates, mode);
    var screened = tools.guard().blocks(caster, ProtectedAction.BUILD, eligible);
    return screened.isEmpty()
        ? Result.err(CastProblem.nothingAllowed(screened, "open space"))
        : Result.ok(screened.allowed());
  }

  /** The world's blocks at {@code positions}. */
  static List<Block> blocks(World world, List<BlockPos> positions) {
    return positions.stream().map(pos -> world.getBlockAt(pos.x(), pos.y(), pos.z())).toList();
  }

  /** The block position containing {@code block}. */
  static BlockPos pos(Block block) {
    return new BlockPos(block.getX(), block.getY(), block.getZ());
  }
}
