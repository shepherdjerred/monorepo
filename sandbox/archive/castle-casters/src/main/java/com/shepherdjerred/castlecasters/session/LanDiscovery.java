package com.shepherdjerred.castlecasters.session;

import static com.shepherdjerred.castlecasters.session.SessionWire.*;

import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * Small, versioned UDP discovery. Direct addresses remain available on networks blocking
 * broadcasts.
 */
public final class LanDiscovery implements AutoCloseable {
  public static final int PORT = 35568;

  public record Host(String address, int port, String name, long seen) {}

  private final DatagramSocket socket;
  private final Thread reader;
  private final Map<String, Host> hosts = new ConcurrentHashMap<>();
  private volatile boolean closed;
  private volatile String error = "";
  private final int hostPort;

  public LanDiscovery(int hostPort) throws SocketException {
    this.hostPort = hostPort;
    socket = new DatagramSocket(hostPort > 0 ? PORT : 0);
    socket.setBroadcast(true);
    socket.setSoTimeout(1000);
    reader = new Thread(this::receive, "CASTLE_DISCOVERY");
    reader.start();
  }

  public List<Host> hosts() {
    return hosts.values().stream()
        .filter(h -> System.nanoTime() - h.seen() < 6_000_000_000L)
        .sorted(Comparator.comparing(Host::address))
        .toList();
  }

  public String error() {
    return error;
  }

  public void query() {
    var packet = message("discover");
    try {
      send(JSON.toJson(packet), InetAddress.getByName("255.255.255.255"), PORT);
    } catch (java.io.IOException e) {
      error = "LAN discovery unavailable. Enter the host address.";
    }
  }

  private void receive() {
    while (!closed) {
      try {
        byte[] bytes = new byte[4096];
        var packet = new DatagramPacket(bytes, bytes.length);
        socket.receive(packet);
        var value =
            parse(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
        if (value.get("type").getAsString().equals("discover") && hostPort > 0) {
          var offer = message("offer");
          offer.addProperty("port", hostPort);
          offer.addProperty("name", "Castle Casters");
          send(JSON.toJson(offer), packet.getAddress(), packet.getPort());
        } else if (value.get("type").getAsString().equals("offer") && hostPort == 0) {
          int port = value.get("port").getAsInt();
          if (port < 1 || port > 65535) continue;
          String address = packet.getAddress().getHostAddress();
          hosts.put(
              address + ":" + port, new Host(address, port, "Castle Casters", System.nanoTime()));
        }
      } catch (SocketTimeoutException ignored) {
      } catch (java.io.IOException e) {
        if (!closed) error = "LAN discovery unavailable. Enter the host address.";
      } catch (RuntimeException ignored) {
        /* Ignore unrelated broadcast traffic. */
      }
    }
  }

  private void send(String text, InetAddress address, int port) throws java.io.IOException {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    socket.send(new DatagramPacket(bytes, bytes.length, address, port));
  }

  @Override
  public void close() {
    closed = true;
    socket.close();
    try {
      reader.join(2000);
      if (reader.isAlive()) throw new IllegalStateException("Discovery worker did not stop");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(e);
    }
  }
}
