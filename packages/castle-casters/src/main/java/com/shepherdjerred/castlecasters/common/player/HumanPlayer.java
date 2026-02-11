package com.shepherdjerred.castlecasters.common.player;

import java.util.UUID;

public record HumanPlayer(UUID uuid, String name, Element element) implements Player {

}
