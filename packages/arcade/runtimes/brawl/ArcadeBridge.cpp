// SPDX-License-Identifier: GPL-2.0-or-later
#include "Common/ArcadeBridge.h"
#include "Common/ArcadeWire.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <bit>
#include <charconv>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>
#include <cerrno>

namespace ArcadeBridge {
namespace {
using Clock = std::chrono::steady_clock;
struct Packet { uint32_t kind; uint32_t sequence; double time; std::vector<uint8_t> bytes; };

void Put32(uint8_t* destination, uint32_t value) {
  for (unsigned byte = 0; byte < 4; byte++) destination[byte] = static_cast<uint8_t>(value >> (byte * 8));
}
uint32_t Get32(const uint8_t* source) {
  uint32_t value = 0;
  for (unsigned byte = 0; byte < 4; byte++) value |= static_cast<uint32_t>(source[byte]) << (byte * 8);
  return value;
}
[[noreturn]] void Fatal(const char* message) {
  std::fprintf(stderr, "Arcade bridge failed: %s\n", message);
  std::_Exit(70);
}

class Transport {
public:
  Transport() {
    const char* text = std::getenv("ARCADE_BRIDGE_PORT");
    if (!text) Fatal("missing loopback bootstrap port");
    unsigned port = 0;
    auto result = std::from_chars(text, text + std::strlen(text), port);
    if (result.ec != std::errc{} || *result.ptr != '\0' || port < 1024 || port > 65535) Fatal("invalid loopback bootstrap port");
    fd = socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in address{}; address.sin_family = AF_INET; address.sin_port = htons(static_cast<uint16_t>(port)); address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (fd < 0 || connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) Fatal("could not connect to the host");
    const timeval timeout{0, 250000};
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    writer = std::jthread([this](std::stop_token token) { WriteLoop(token); });
    reader = std::jthread([this](std::stop_token token) { ReadLoop(token); });
    constexpr std::string_view hello = R"({"version":1,"gameId":"brawl","sourceRevision":"2614969fa80dfeb87d2a4ad3bdaa703237127074","format":{"width":640,"height":480,"fps":30,"pixelFormat":"rgba","audioSampleRate":48000,"audioChannels":2,"displayAspect":1.3333333333333333}})";
    Push(ArcadeWire::Kind_hello, std::vector<uint8_t>(hello.begin(), hello.end()));
  }
  ~Transport() {
    writer.request_stop(); reader.request_stop();
    shutdown(fd, SHUT_RDWR); cv.notify_all();
    writer.join(); reader.join(); close(fd);
  }

  void Push(uint32_t kind, std::vector<uint8_t> bytes) {
    std::lock_guard lock(mutex);
    if (kind == ArcadeWire::Kind_video) {
      if (videos.size() >= 2) videos.pop_front();
      videos.push_back(Make(kind, std::move(bytes)));
    } else {
      if (kind == ArcadeWire::Kind_audio) {
        audio_bytes += bytes.size();
        if (audio_bytes > 48000 * 4 * 120 / 1000) Fatal("audio latency window exceeded");
      }
      if (control.size() >= 32) Fatal("telemetry or audio writer is stalled");
      control.push_back(Make(kind, std::move(bytes)));
    }
    cv.notify_one();
  }

  void SetStop(std::function<void()> callback) {
    std::lock_guard lock(mutex);
    stop = std::move(callback);
  }

private:
  Packet Make(uint32_t kind, std::vector<uint8_t> bytes) {
    return {kind, ++sequence, std::chrono::duration<double, std::milli>(Clock::now() - epoch).count(), std::move(bytes)};
  }
  void WriteAll(const uint8_t* bytes, size_t length, std::stop_token token) {
    size_t offset = 0;
    while (offset < length && !token.stop_requested()) {
      const ssize_t written = send(fd, bytes + offset, length - offset, MSG_NOSIGNAL);
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) { if (token.stop_requested()) return; Fatal("media socket stopped draining"); }
      offset += static_cast<size_t>(written);
    }
  }
  void WriteLoop(std::stop_token token) {
    while (!token.stop_requested()) {
      Packet packet;
      {
        std::unique_lock lock(mutex);
        cv.wait(lock, [&] { return token.stop_requested() || !control.empty() || !videos.empty(); });
        if (token.stop_requested()) return;
        auto& queue = control.empty() ? videos : control;
        packet = std::move(queue.front()); queue.pop_front();
        if (packet.kind == ArcadeWire::Kind_audio) audio_bytes -= packet.bytes.size();
      }
      std::array<uint8_t, ArcadeWire::HeaderBytes> header{};
      std::copy(std::begin(ArcadeWire::Magic), std::end(ArcadeWire::Magic), header.begin());
      Put32(header.data() + ArcadeWire::Offset_kind, packet.kind);
      Put32(header.data() + ArcadeWire::Offset_length, static_cast<uint32_t>(packet.bytes.size()));
      Put32(header.data() + ArcadeWire::Offset_sequence, packet.sequence);
      const uint64_t time = std::bit_cast<uint64_t>(packet.time);
      for (unsigned byte = 0; byte < 8; byte++) header[ArcadeWire::Offset_timeMs + byte] = static_cast<uint8_t>(time >> (byte * 8));
      WriteAll(header.data(), header.size(), token); WriteAll(packet.bytes.data(), packet.bytes.size(), token);
    }
  }
  bool ReadAll(uint8_t* bytes, size_t length, std::stop_token token) {
    size_t offset = 0;
    while (offset < length && !token.stop_requested()) {
      const ssize_t received = recv(fd, bytes + offset, length - offset, 0);
      if (received < 0 && errno == EINTR) continue;
      if (received <= 0) return false;
      offset += static_cast<size_t>(received);
    }
    return offset == length;
  }
  void ReadLoop(std::stop_token token) {
    std::array<uint8_t, ArcadeWire::HeaderBytes> header{};
    while (ReadAll(header.data(), header.size(), token)) {
      if (!std::equal(std::begin(ArcadeWire::Magic), std::end(ArcadeWire::Magic), header.begin())) Fatal("invalid control header");
      if (Get32(header.data() + ArcadeWire::Offset_length) != 0 || Get32(header.data() + ArcadeWire::Offset_kind) != ArcadeWire::Kind_stop) Fatal("unsupported control command");
      std::function<void()> callback;
      { std::lock_guard lock(mutex); callback = stop; }
      if (!callback) Fatal("stop handler is unavailable");
      callback(); return;
    }
    if (!token.stop_requested()) Fatal("control connection closed unexpectedly");
  }

  int fd = -1;
  const Clock::time_point epoch = Clock::now();
  uint32_t sequence = 0;
  size_t audio_bytes = 0;
  std::mutex mutex;
  std::condition_variable cv;
  std::deque<Packet> control, videos;
  std::function<void()> stop;
  std::jthread writer, reader;
};

Transport& Get() { static Transport transport; return transport; }
}

bool Enabled() { return std::getenv("ARCADE_BRIDGE_PORT") != nullptr; }
void SetStopCallback(std::function<void()> callback) { if (Enabled()) Get().SetStop(std::move(callback)); }

void Video(const uint8_t* rgba, int width, int height, int stride) {
  if (!Enabled()) return;
  if (width != 640 || height != 480 || stride < width * 4) Fatal("unexpected framebuffer shape");
  std::vector<uint8_t> bytes(static_cast<size_t>(width) * height * 4);
  for (int row = 0; row < height; row++) std::memcpy(bytes.data() + static_cast<size_t>(row) * width * 4, rgba + static_cast<size_t>(row) * stride, static_cast<size_t>(width) * 4);
  Get().Push(ArcadeWire::Kind_video, std::move(bytes));
}
void Audio(const int16_t* stereo, size_t frames) {
  if (!Enabled()) return;
  if (frames > 48000 * 120 / 1000) Fatal("audio batch exceeded its window");
  const auto* bytes = reinterpret_cast<const uint8_t*>(stereo);
  Get().Push(ArcadeWire::Kind_audio, std::vector<uint8_t>(bytes, bytes + frames * 4));
}
void Telemetry(std::string_view json) {
  if (!Enabled()) return;
  if (json.size() > ArcadeWire::Limit_telemetry) Fatal("telemetry packet exceeded its limit");
  Get().Push(ArcadeWire::Kind_telemetry, std::vector<uint8_t>(json.begin(), json.end()));
}
void Error(std::string_view message) {
  if (Enabled()) Get().Push(ArcadeWire::Kind_error, std::vector<uint8_t>(message.begin(), message.end()));
}
}
