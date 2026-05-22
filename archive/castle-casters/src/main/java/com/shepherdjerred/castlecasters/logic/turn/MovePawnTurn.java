package com.shepherdjerred.castlecasters.logic.turn;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;

public interface MovePawnTurn extends Turn {

  Coordinate source();

  Coordinate destination();
}
