package com.shepherdjerred.castlecasters.logic.match.serialization;

import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.MatchSettings;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class MatchJsonSerializerTest {

  @Test
  public void test() {
    var originalMatch = Match.from(new MatchSettings(10, QuoridorPlayer.ONE, PlayerCount.TWO),
        new BoardSettings(9, PlayerCount.TWO));

    var serializer = new MatchJsonSerializer();

    var bytes = serializer.toBytes(originalMatch);
    var deserializedMatch = serializer.fromBytes(bytes);

    Assertions.assertEquals(originalMatch, deserializedMatch);
  }
}
