package com.shepherdjerred.castlecasters.storage.save;

import java.nio.file.Path;
import java.time.Instant;

public record SavedGameFile(String name, Instant time, Path path) implements SavedGame {

}
