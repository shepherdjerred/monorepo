package com.shepherdjerred.castlecasters.storage.save;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.serialization.MatchJsonSerializer;

import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class FilesystemSavedGameRepository implements SavedGameRepository {

  private static final MatchJsonSerializer serializer = new MatchJsonSerializer();
  private final Path directory;

  public FilesystemSavedGameRepository(Path directory) {
    this.directory = directory;
  }

  @Override
  public Set<SavedGame> getSaves() throws IOException {
    try (Stream<Path> files = Files.walk(directory)) {
      return files
          .filter(Files::isRegularFile)
          .filter(this::hasExtension)
          .map(this::getSavedGameFromPath)
          .filter(Optional::isPresent)
          .map(Optional::get)
          .collect(Collectors.toSet());
    }
  }

  private Optional<SavedGameFile> getSavedGameFromPath(Path path) {
    var savedGame = new SavedGameFile(path.getFileName().toString(), Instant.now(), path);
    return Optional.of(savedGame);
  }

  private boolean hasExtension(Path path) {
    return path.getFileName().toString().endsWith(".match");
  }

  @Override
  public Optional<Match> loadMatch(SavedGame savedGame) throws IOException {
    String fileAsString = Files.readString(Paths.get(savedGame.name()));
    var match = serializer.fromJsonString(fileAsString);
    if (match != null) {
      return Optional.of(match);
    }
    return Optional.empty();
  }

  @Override
  public void saveMatch(String name, Match match) throws IOException {
    try (var writer = new FileWriter(name)) {
      writer.write(serializer.toJsonString(match));
    }
  }

  public void deleteSave(String name) throws IOException {
    Files.deleteIfExists(Paths.get(name));
  }
}
