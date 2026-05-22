package com.shepherdjerred.castlecasters.logic.turn;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;

public interface JumpPawnTurn extends MovePawnTurn {

  Coordinate pivot();
}
