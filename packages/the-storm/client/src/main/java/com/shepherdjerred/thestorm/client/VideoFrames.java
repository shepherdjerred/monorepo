package com.shepherdjerred.thestorm.client;

import com.mojang.blaze3d.platform.NativeImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.jspecify.annotations.Nullable;

/** One ordered, bounded disk writer. GPU images always have an explicit owner and close path. */
final class VideoFrames {
  record Frame(int index, long elapsedNanos, long worldTick, VideoCapture.Camera camera) {}

  record Written(Frame frame, String file, String sha256) {}

  record Receipt(
      int schema,
      String kind,
      String acceptance,
      String source,
      int fps,
      int requestedFrames,
      boolean complete,
      String error,
      List<Written> frames) {}

  record DuelReceipt(
      int schema,
      String kind,
      String acceptance,
      String source,
      int fps,
      int requestedFrames,
      boolean complete,
      String error,
      List<Written> frames,
      DuelWindow.Receipt duel) {}

  private final Path directory;
  private final ExecutorService io;
  private final Semaphore pending = new Semaphore(8);
  private final AtomicReference<String> failure = new AtomicReference<>("");
  private final List<Written> written = new ArrayList<>();
  private final CompletableFuture<Written> terminal = new CompletableFuture<>();
  private final List<CompletableFuture<?>> holds = new ArrayList<>();

  VideoFrames(Path directory, ExecutorService io) {
    this.directory = directory;
    this.io = io;
  }

  CompletableFuture<Path> prepare() {
    return CompletableFuture.supplyAsync(
        () -> {
          try {
            Files.createDirectory(
                directory,
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            return directory;
          } catch (IOException e) {
            throw new IllegalStateException("Cannot create exclusive frame directory", e);
          }
        },
        io);
  }

  void reserve() {
    if (!pending.tryAcquire()) throw new IllegalStateException("Frame writer is overloaded");
  }

  void reject(String reason) {
    failure.compareAndSet("", reason);
    pending.release();
  }

  void write(NativeImage image, Frame frame, boolean terminalFrame) {
    try {
      io.execute(() -> persist(image, frame, terminalFrame));
    } catch (RuntimeException e) {
      image.close();
      if (terminalFrame) terminal.completeExceptionally(e);
      reject(e.toString());
    }
  }

  private void persist(NativeImage image, Frame frame, boolean terminalFrame) {
    try (image) {
      if (image.getWidth() != 1280 || image.getHeight() != 720) {
        throw new IllegalStateException("Capture requires actual 1280x720 render pixels");
      }
      var name = name(frame.index());
      var destination = directory.resolve(name);
      FramePng.write(destination, image.getWidth(), image.getHeight(), image.getPixels());
      var saved = new Written(frame, name, sha256(destination));
      written.add(saved);
      if (terminalFrame && !terminal.complete(saved))
        throw new IllegalStateException("Terminal image was captured twice");
    } catch (IOException | RuntimeException e) {
      failure.compareAndSet("", e.toString());
      if (terminalFrame) terminal.completeExceptionally(e);
    } finally {
      pending.release();
    }
  }

  void hold(Frame frame, int sourceFrame) {
    var executed = new AtomicBoolean();
    var future =
        terminal
            .handleAsync(
                (source, error) -> {
                  executed.set(true);
                  try {
                    if (error != null)
                      throw new IllegalStateException("Terminal render was not persisted", error);
                    var saved = java.util.Objects.requireNonNull(source);
                    if (saved.frame().index() != sourceFrame || sourceFrame >= frame.index())
                      throw new IllegalStateException("Terminal image identity changed");
                    var name = name(frame.index());
                    var destination = directory.resolve(name);
                    Files.copy(directory.resolve(saved.file()), destination);
                    var hash = sha256(destination);
                    if (!hash.equals(saved.sha256()))
                      throw new IllegalStateException("Terminal pixels changed during hold");
                    written.add(new Written(frame, name, hash));
                  } catch (IOException | RuntimeException e) {
                    failure.compareAndSet("", e.toString());
                  } finally {
                    pending.release();
                  }
                  return null;
                },
                io)
            .whenComplete(
                (_, error) -> {
                  if (error != null && !executed.get()) reject(error.toString());
                });
    holds.add(future);
  }

  private static String name(int index) {
    return String.format(java.util.Locale.ROOT, "%06d.png", index);
  }

  boolean drained() {
    return pending.availablePermits() == 8;
  }

  String failure() {
    return failure.get();
  }

  CompletableFuture<Path> finish(int total, String error, DuelWindow.@Nullable Receipt duel) {
    return CompletableFuture.supplyAsync(
        () -> {
          var receipt = directory.resolve("frames.json");
          requireHoldsQuiescent();
          if (error.isEmpty() && written.size() != total) {
            throw new IllegalStateException(
                "Frame inventory is incomplete without a failure reason");
          }
          var inventory =
              written.stream()
                  .sorted(java.util.Comparator.comparingInt(entry -> entry.frame().index()))
                  .toList();
          Object result;
          if (duel == null)
            result =
                new Receipt(
                    1,
                    "rwf-rendered-frames",
                    "unaccepted",
                    "minecraft-framebuffer",
                    FrameClock.FPS,
                    total,
                    error.isEmpty(),
                    error,
                    inventory);
          else
            result =
                new DuelReceipt(
                    3,
                    "rwf-rendered-duel-frames",
                    "unaccepted",
                    "minecraft-framebuffer",
                    FrameClock.FPS,
                    total,
                    error.isEmpty(),
                    error,
                    inventory,
                    duel);
          try {
            Files.writeString(
                receipt,
                Protocol.JSON.writeValueAsString(result) + "\n",
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE);
          } catch (IOException e) {
            throw new IllegalStateException("Cannot seal frame receipt", e);
          }
          return receipt;
        },
        io);
  }

  private void requireHoldsQuiescent() {
    for (var hold : holds) {
      if (!hold.isDone()) throw new IllegalStateException("Terminal writer did not quiesce");
      if (!hold.isCompletedExceptionally()) hold.getNow(null);
      else if (failure.get().isEmpty())
        throw new IllegalStateException("Terminal writer failed without a reason");
    }
  }

  private static String sha256(Path file) throws IOException {
    MessageDigest digest;
    try {
      digest = MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 unavailable", e);
    }
    try (var stream = new DigestInputStream(Files.newInputStream(file), digest)) {
      stream.transferTo(java.io.OutputStream.nullOutputStream());
    }
    return HexFormat.of().formatHex(digest.digest());
  }
}
