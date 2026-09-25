package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.Explanations;
import com.shepherdjerred.thestorm.tracks.domain.TracksConfig;
import com.shepherdjerred.thestorm.tracks.domain.Wording;
import com.shepherdjerred.thestorm.tracks.domain.purchase.TrackStanding;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;

/** Turns track standings and the configured level descriptions into chat lines. */
final class Presenter {

  private final TracksConfig config;
  private final Explanations explanations;

  Presenter(TracksConfig config, Explanations explanations) {
    this.config = config;
    this.explanations = explanations;
  }

  Explanations explanations() {
    return explanations;
  }

  /** {@code track}'s name in its color. */
  Component name(Track track) {
    return Component.text(explanations.name(track), TextColor.color(config.info(track).rgb()));
  }

  /** The {@code /perks} lines: one per track, then a hint. */
  List<Component> overview(List<TrackStanding> standings, Instant now) {
    var lines = new ArrayList<Component>();
    lines.add(Replies.info("Your tracks:"));
    for (var standing : standings) {
      lines.add(standingLine(standing, now));
    }
    lines.add(
        Component.text(
            "Buy the next level with /perks buy <track>; see what each level unlocks with /perks"
                + " info <track>.",
            NamedTextColor.DARK_GRAY));
    return lines;
  }

  private Component standingLine(TrackStanding standing, Instant now) {
    var track = standing.track();
    var line =
        Component.text()
            .append(Component.text(" - ", NamedTextColor.DARK_GRAY))
            .append(name(track))
            .append(
                Component.text(
                    standing.level() == 0 ? " untrained" : " " + Wording.numeral(standing.level()),
                    NamedTextColor.WHITE));
    if (standing.primary()) {
      line.append(Component.text(" (primary)", NamedTextColor.GOLD));
    }
    var next = standing.next();
    if (next.isEmpty()) {
      return line.append(Component.text(" - maxed", NamedTextColor.GRAY)).build();
    }
    var quote = next.get();
    line.append(
        Component.text(
            " - next "
                + Wording.numeral(quote.level())
                + ": "
                + explanations.crystals(quote.cost()),
            NamedTextColor.GRAY));
    if (standing.problems().isEmpty()) {
      return line.append(
              Component.text(" - /perks buy " + track.id(), NamedTextColor.GREEN)
                  .decorate(TextDecoration.ITALIC))
          .build();
    }
    var reason = explanations.explain(standing.problems().getFirst(), now);
    return line.append(Component.text(" - " + reason, NamedTextColor.RED)).build();
  }

  /** The {@code /perks info} lines for {@code track}, marking levels at or below {@code owned}. */
  List<Component> info(Track track, int owned) {
    var info = config.info(track);
    var lines = new ArrayList<Component>();
    lines.add(
        Replies.info(
            Component.text()
                .append(name(track))
                .append(Component.text(": " + info.summary(), NamedTextColor.GRAY))
                .build()));
    for (var level = 1; level <= Track.MAX_LEVEL; level++) {
      var levelInfo = info.level(level);
      var reached = level <= owned;
      lines.add(
          Component.text()
              .append(
                  Component.text(
                      (reached ? " + " : " - ") + Wording.numeral(level) + " ",
                      reached ? NamedTextColor.GREEN : NamedTextColor.DARK_GRAY))
              .append(Component.text(levelInfo.title(), TextColor.color(info.rgb())))
              .build());
      for (var unlock : levelInfo.unlocks()) {
        lines.add(Component.text("     " + unlock, NamedTextColor.GRAY));
      }
    }
    return lines;
  }
}
