package com.shepherdjerred.castlecasters.logic.match;

import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public record MatchStatus(QuoridorPlayer victor,
                          com.shepherdjerred.castlecasters.logic.match.MatchStatus.Status status) {

  public enum Status {
    IN_PROGRESS, VICTORY, STALEMATE
  }
}
