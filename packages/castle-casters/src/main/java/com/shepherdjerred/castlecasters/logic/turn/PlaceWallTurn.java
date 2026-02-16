package com.shepherdjerred.castlecasters.logic.turn;

import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public record PlaceWallTurn(QuoridorPlayer causer, WallLocation location) implements Turn {

}
