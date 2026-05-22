package com.shepherdjerred.castlecasters.storage.save;

import java.time.Instant;

public interface SavedGame {

  String name();

  Instant time();
}
