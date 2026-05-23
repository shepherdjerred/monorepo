package com.shepherdjerred.castlecasters.logic.turn;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public record JumpPawnDiagonalTurn(QuoridorPlayer causer, Coordinate source, Coordinate destination,
                                   Coordinate pivot) implements JumpPawnTurn {

}
