// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string_view>

namespace ArcadeBridge {
bool Enabled();
void SetStopCallback(std::function<void()> callback);
void Video(const uint8_t* rgba, int width, int height, int stride);
void Audio(const int16_t* stereo, size_t frames);
void Telemetry(std::string_view json);
void Error(std::string_view message);
}
