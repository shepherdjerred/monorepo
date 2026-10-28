package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateIntegrityRules;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import org.bukkit.Tag;
import org.bukkit.block.Sign;
import org.bukkit.block.data.FaceAttachable;
import org.bukkit.block.data.type.Switch;
import org.bukkit.block.sign.Side;

/** Rechecks a gate's physical structure and sign before acting on stored coordinates. */
final class StargateIntegrity {
  private enum Mode {
    CLOSED,
    OPEN,
    RECOVERY
  }

  private StargateIntegrity() {}

  static boolean button(PaperGrid grid, Pos position, Direction facing) {
    if (!grid.contains(position) || !grid.loaded(position)) return false;
    var block = grid.block(position);
    return Tag.BUTTONS.isTagged(block.getType())
        && block.getBlockData() instanceof Switch button
        && button.getAttachedFace() == FaceAttachable.AttachedFace.WALL
        && button.getFacing().getModX() == facing.dx()
        && button.getFacing().getModZ() == facing.dz();
  }

  static boolean valid(PaperGrid grid, Stargate gate, StargateNetwork network, boolean open) {
    return check(grid, gate, network, open ? Mode.OPEN : Mode.CLOSED);
  }

  static boolean recoverable(PaperGrid grid, Stargate gate, StargateNetwork network) {
    return check(grid, gate, network, Mode.RECOVERY);
  }

  private static boolean check(PaperGrid grid, Stargate gate, StargateNetwork network, Mode mode) {
    if (!grid.world().getUID().equals(gate.worldId()) || !grid.loaded(gate.sign())) return false;
    if (!(grid.block(gate.sign()).getState() instanceof Sign sign)) return false;
    var view =
        PaperGrid.view(
            grid.block(gate.sign()),
            sign.getSide(Side.FRONT).lines().stream().map(PaperGrid::plain).toList());
    var buttonMatches = button(grid, gate.button(), gate.facing());
    var inspection =
        new StargateIntegrityRules.Inspection(grid, gate, network, view, buttonMatches);
    return mode == Mode.RECOVERY
        ? StargateIntegrityRules.recoverable(inspection)
        : StargateIntegrityRules.valid(inspection, mode == Mode.OPEN);
  }
}
