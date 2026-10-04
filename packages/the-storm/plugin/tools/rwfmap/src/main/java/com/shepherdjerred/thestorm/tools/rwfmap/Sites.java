package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.map.BombOwner;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Optional;

/**
 * The map's spawns and bombs as rwfbots names them: spawns {@code <color>-spawn-<n>} on the cell
 * the player's feet occupy, bombs by their map.yml id on the TNT block, teams as the lower-case
 * {@link TeamColor} name and nukes without a team.
 */
final class Sites {

  private Sites() {}

  static NavSites of(MapDefinition definition) {
    var spawns = new ArrayList<NavSites.Site>();
    for (var team : definition.teams()) {
      var color = teamName(team.color());
      var n = 0;
      for (var spawn : team.spawns()) {
        n++;
        var position = spawn.position();
        var feet =
            new BlockPos(
                (int) Math.floor(position.x()),
                (int) Math.floor(position.y()),
                (int) Math.floor(position.z()));
        spawns.add(new NavSites.Site(color + "-spawn-" + n, Optional.of(color), feet));
      }
    }
    var bombs = new ArrayList<NavSites.Site>();
    for (var bomb : definition.bombs()) {
      var team =
          switch (bomb.owner()) {
            case BombOwner.Team(var color) -> Optional.of(teamName(color));
            case BombOwner.Nuke _ -> Optional.<String>empty();
          };
      var at = bomb.position();
      bombs.add(new NavSites.Site(bomb.id(), team, new BlockPos(at.x(), at.y(), at.z())));
    }
    return new NavSites(spawns, bombs);
  }

  static String teamName(TeamColor color) {
    return color.name().toLowerCase(Locale.ROOT);
  }
}
