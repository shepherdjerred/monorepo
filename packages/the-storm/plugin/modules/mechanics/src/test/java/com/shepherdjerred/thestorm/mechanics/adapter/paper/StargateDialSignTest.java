package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.block.sign.SignSide;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class StargateDialSignTest {
  private static List<String> text(List<net.kyori.adventure.text.Component> lines) {
    return lines.stream().map(PlainTextComponentSerializer.plainText()::serialize).toList();
  }

  @Test
  void cyclesWithPreviousAndNextDestinations() {
    var names = List.of("2026", "2015", "Skylands", "Creative");
    assertThat(text(StargateDialSign.lines("World Gate", names, 0)))
        .containsExactly("World Gate", "Creative", ">2026<", "2015");
    assertThat(text(StargateDialSign.lines("World Gate", names, 2)))
        .containsExactly("World Gate", "2015", ">Skylands<", "Creative");
  }

  @Test
  void handlesOneOrTwoDestinationsWithoutDuplicatingEntries() {
    assertThat(text(StargateDialSign.lines("Gate", List.of("One"), 0)))
        .containsExactly("Gate", "", ">One<", "");
    assertThat(text(StargateDialSign.lines("Gate", List.of("One", "Two"), 1)))
        .containsExactly("Gate", "", ">Two<", "One");
  }

  @Test
  void boundsLongNamesAndRejectsInvalidSelection() {
    var lines =
        text(
            StargateDialSign.lines(
                "a very long gate name", List.of("a very long destination name"), 0));
    assertThat(lines).allSatisfy(line -> assertThat(line.length()).isLessThanOrEqualTo(15));
    assertThat(lines.get(2)).startsWith(">").endsWith("<");
    assertThatThrownBy(() -> StargateDialSign.lines("Gate", List.of(), 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void sendsTheRenderedSnapshotWithoutWritingThePhysicalSign() {
    var player = mock(Player.class);
    var block = mock(Block.class);
    var sign = mock(Sign.class);
    var side = mock(SignSide.class);
    var location = mock(Location.class);
    when(block.getState()).thenReturn(sign);
    when(block.getLocation()).thenReturn(location);
    when(sign.getSide(Side.FRONT)).thenReturn(side);
    var lines = StargateDialSign.lines("World Gate", List.of("2026", "2015"), 0);

    StargateDialSign.show(player, block, lines);

    verify(side).line(2, lines.get(2));
    verify(player).sendBlockUpdate(location, sign);
    verify(sign, never()).update();
  }
}
