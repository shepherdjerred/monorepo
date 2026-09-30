package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.Facts;
import com.shepherdjerred.thestorm.quests.domain.engine.GameTime;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Weather;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.util.Arrays;
import org.bukkit.entity.Player;

/** What the live world says about an online player. Main thread. */
final class PaperFacts implements Facts {

  private final Player player;
  private final TrackLevels tracks;
  private final QuestContent content;

  PaperFacts(Player player, TrackLevels tracks, QuestContent content) {
    this.player = player;
    this.tracks = tracks;
    this.content = content;
  }

  @Override
  public int count(ItemMatch item) {
    return ItemStacks.count(player, item);
  }

  @Override
  public int trackLevel(String track) {
    return Arrays.stream(Track.values())
        .filter(candidate -> candidate.id().equals(track))
        .findFirst()
        .map(found -> tracks.level(player, found))
        .orElse(0);
  }

  @Override
  public int minuteOfDay() {
    return GameTime.minuteOfDay(player.getWorld().getTime());
  }

  @Override
  public Weather weather() {
    var world = player.getWorld();
    if (world.isThundering()) {
      return Weather.THUNDER;
    }
    return world.hasStorm() ? Weather.RAIN : Weather.CLEAR;
  }

  @Override
  public boolean inRegion(String region) {
    var location = Locations.of(player);
    return content
        .region(region)
        .filter(
            found ->
                found.contains(
                    player.getWorld().getKey().asString(),
                    location.getX(),
                    location.getY(),
                    location.getZ()))
        .isPresent();
  }

  @Override
  public boolean hasPermission(String node) {
    return player.hasPermission(node);
  }
}
