package com.shepherdjerred.castlecasters.common.player;

import java.util.UUID;

public interface Player {

  UUID uuid();

  String name();

  Element element();
}
