// Generated from runtimes/wire.json. Run the Arcade generate task.
#pragma once
#include <cstdint>
namespace ArcadeWire {
inline constexpr uint8_t Magic[] = {65,82,67,68};
inline constexpr uint32_t HeaderBytes = 24;
inline constexpr uint32_t Offset_kind = 4;
inline constexpr uint32_t Offset_length = 8;
inline constexpr uint32_t Offset_sequence = 12;
inline constexpr uint32_t Offset_timeMs = 16;
inline constexpr uint32_t Kind_hello = 1;
inline constexpr uint32_t Kind_video = 2;
inline constexpr uint32_t Kind_audio = 3;
inline constexpr uint32_t Kind_telemetry = 4;
inline constexpr uint32_t Kind_error = 5;
inline constexpr uint32_t Kind_saved = 6;
inline constexpr uint32_t Kind_input = 7;
inline constexpr uint32_t Kind_flush = 8;
inline constexpr uint32_t Kind_stop = 9;
inline constexpr uint32_t Limit_hello = 65536;
inline constexpr uint32_t Limit_video = 8294400;
inline constexpr uint32_t Limit_audio = 48000;
inline constexpr uint32_t Limit_telemetry = 65536;
inline constexpr uint32_t Limit_error = 4096;
inline constexpr uint32_t Limit_saved = 4096;
inline constexpr uint32_t Limit_input = 4096;
inline constexpr uint32_t Limit_flush = 4096;
inline constexpr uint32_t Limit_stop = 4096;
inline constexpr uint32_t Pad_left = 1;
inline constexpr uint32_t Pad_right = 2;
inline constexpr uint32_t Pad_down = 4;
inline constexpr uint32_t Pad_up = 8;
inline constexpr uint32_t Pad_z = 16;
inline constexpr uint32_t Pad_r = 32;
inline constexpr uint32_t Pad_l = 64;
inline constexpr uint32_t Pad_a = 256;
inline constexpr uint32_t Pad_b = 512;
inline constexpr uint32_t Pad_x = 1024;
inline constexpr uint32_t Pad_y = 2048;
inline constexpr uint32_t Pad_start = 4096;
}
