package com.shepherdjerred.thestorm.e2e;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import jdk.jfr.consumer.RecordingFile;

/** All diagnostic filesystem work stays on the owned recording worker. */
final class DiagnosticJfrFiles {
  record Export(String sha256, long bytes, long events, Map<String, Long> eventTypes) {}

  private DiagnosticJfrFiles() {}

  static Path prepare(Path root, UUID attempt, DiagnosticJfrSettings.Settings settings)
      throws IOException {
    var directoryMode = PosixFilePermissions.fromString("rwx------");
    Files.createDirectories(root, PosixFilePermissions.asFileAttribute(directoryMode));
    if (Files.isSymbolicLink(root)
        || !Files.getPosixFilePermissions(root, LinkOption.NOFOLLOW_LINKS).equals(directoryMode))
      throw new IOException("diagnostic root must be a private real directory");
    var directory = root.resolve(attempt.toString());
    Files.createDirectory(directory, PosixFilePermissions.asFileAttribute(directoryMode));
    writePrivate(directory.resolve("paper.jfc"), settings.originalXml());
    var encoded = new StringBuilder();
    new TreeMap<>(settings.values())
        .forEach((key, value) -> encoded.append(key).append('=').append(value).append('\n'));
    writePrivate(directory.resolve("applied-settings.txt"), encoded.toString());
    var destination = directory.resolve("capture.jfr");
    Files.createFile(
        destination,
        PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
    return destination;
  }

  private static void writePrivate(Path path, String text) throws IOException {
    Files.createFile(
        path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
    Files.writeString(path, text, StandardCharsets.UTF_8, StandardOpenOption.WRITE);
  }

  static Export inspect(Path destination) throws IOException {
    var types = new TreeMap<String, Long>();
    long events = 0;
    try (var file = new RecordingFile(destination)) {
      while (file.hasMoreEvents()) {
        var event = file.readEvent();
        types.merge(event.getEventType().getName(), 1L, Long::sum);
        events++;
      }
    }
    return new Export(hash(destination), Files.size(destination), events, Map.copyOf(types));
  }

  private static String hash(Path path) throws IOException {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      try (var input = Files.newInputStream(path)) {
        var buffer = new byte[64 * 1024];
        for (int read; (read = input.read(buffer)) != -1; ) digest.update(buffer, 0, read);
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException failure) {
      throw new IllegalStateException("JDK lacks required SHA-256", failure);
    }
  }
}
