package com.shepherdjerred.thestorm.client;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;

record Session(Path socket, Path artifacts, String server) {
  static Session read(Path file) throws IOException {
    var node = Protocol.JSON.readTree(Files.readString(file));
    Protocol.keys(node, Set.of("socket", "artifacts", "server"));
    var socket = Path.of(Protocol.text(node, "socket", 1024));
    var artifacts = Path.of(Protocol.text(node, "artifacts", 1024));
    var server = Protocol.text(node, "server", 100);
    if (!socket.isAbsolute() || !artifacts.isAbsolute()) {
      throw new IllegalArgumentException("Session paths must be absolute");
    }
    if (!server.matches("127\\.0\\.0\\.1:[0-9]{1,5}")) {
      throw new IllegalArgumentException("Preview requires a loopback server");
    }
    var port = Integer.parseInt(server.substring(server.lastIndexOf(':') + 1));
    if (port < 1 || port > 65_535) throw new IllegalArgumentException("Invalid server port");
    if (!Files.isDirectory(artifacts))
      throw new IllegalArgumentException("Missing artifact directory");
    return new Session(socket, artifacts, server);
  }
}
