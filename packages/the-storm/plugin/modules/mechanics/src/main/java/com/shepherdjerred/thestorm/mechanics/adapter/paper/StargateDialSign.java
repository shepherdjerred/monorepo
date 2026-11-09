package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;

/** Renders the dial to each client without modifying the stored, protected sign. */
final class StargateDialSign {
  private StargateDialSign() {}

  static List<Component> lines(String title, List<String> destinations, int selected) {
    if (destinations.isEmpty() || selected < 0 || selected >= destinations.size())
      throw new IllegalArgumentException("invalid Stargate dial selection");
    var previous =
        destinations.size() > 2
            ? destinations.get((selected + destinations.size() - 1) % destinations.size())
            : "";
    var next =
        destinations.size() > 1 ? destinations.get((selected + 1) % destinations.size()) : "";
    return List.of(
        Component.text(fit(title, 15)),
        Component.text(fit(previous, 15)),
        Component.text(">" + fit(destinations.get(selected), 13) + "<"),
        Component.text(fit(next, 15)));
  }

  private static String fit(String value, int limit) {
    return value.length() <= limit ? value : value.substring(0, limit - 1) + "…";
  }

  static void show(Player player, Block block, List<Component> lines) {
    if (!(block.getState() instanceof Sign sign)) return;
    var side = sign.getSide(Side.FRONT);
    for (var index = 0; index < lines.size(); index++) side.line(index, lines.get(index));
    player.sendBlockUpdate(block.getLocation(), sign);
  }

  static void restore(Player player, Block block) {
    if (!(block.getState() instanceof Sign sign)) return;
    player.sendBlockUpdate(block.getLocation(), sign);
  }
}
