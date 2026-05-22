package com.shepherdjerred.castlecasters.logic.match.serialization;

import com.shepherdjerred.castlecasters.logic.match.Match;

public interface MatchSerializer {
  byte[] toBytes(Match match);

  Match fromBytes(byte[] bytes);
}
