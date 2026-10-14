// SPDX-License-Identifier: GPL-2.0-or-later
// RSBE01 revision 2. Pointer chains and result words were verified against the
// matching DOL/REL symbols and a four-controller match through sudden death.
#include "Core/ArcadeTelemetry.h"
#include "Common/ArcadeBridge.h"
#include "Core/ConfigManager.h"
#include "Core/Host.h"
#include "Core/PowerPC/MMU.h"
#include <cmath>
#include <cstdint>
#include <sstream>
#include <string>

namespace ArcadeBrawl {
namespace {
template<class T> T Read(const Core::CPUThreadGuard& guard, uint32_t address) {
  return PowerPC::MMU::HostRead<T>(guard, address);
}
bool Ram(const Core::CPUThreadGuard& guard, uint32_t pointer) {
  return pointer != 0 && PowerPC::MMU::HostIsRAMAddress(guard, pointer);
}
uint32_t Pointer(const Core::CPUThreadGuard& guard, uint32_t address) {
  const uint32_t pointer = Read<uint32_t>(guard, address);
  return Ram(guard, pointer) ? pointer : 0;
}
std::string Scene(const Core::CPUThreadGuard& guard) {
  const uint32_t manager = Pointer(guard, 0x805a0060);
  if (!manager) return "";
  const uint32_t scene = Pointer(guard, manager + 4);
  if (!scene) return "";
  const uint32_t name = Pointer(guard, scene);
  if (!name) return "";
  std::string result;
  for (uint32_t index = 0; index < 31; index++) {
    const uint8_t value = Read<uint8_t>(guard, name + index);
    if (!value) return result;
    if (value < 32 || value > 126 || value == '"' || value == '\\') return "";
    result.push_back(static_cast<char>(value));
  }
  return "";
}
}

void Observe(const Core::CPUThreadGuard& guard) {
  if (!ArcadeBridge::Enabled()) return;
  const auto& config = SConfig::GetInstance();
  if (config.GetGameID() != "RSBE01" || config.GetRevision() != 2) {
    ArcadeBridge::Error("Brawl requires the verified RSBE01 revision 2 disc");
    Host_Message(HostMessageID::WMUserStop);
    return;
  }
  const uint32_t global = Pointer(guard, 0x805a00e0);
  const uint32_t mode = global ? Pointer(guard, global + 8) : 0;
  const uint32_t result = global ? Pointer(guard, global + 0x18) : 0;
  const std::string scene = mode && result ? Scene(guard) : "";
  const bool playing = scene == "scMelee";
  const bool relevant = playing || scene == "scVsResult";
  std::ostringstream json;
  json << "{\"scene\":\"" << scene << "\",\"modeRule\":" << (mode ? Read<uint32_t>(guard, mode + 8) : 0)
       << ",\"stage\":" << (mode ? Read<uint32_t>(guard, mode + 0x18) : 0)
       << ",\"teams\":" << (mode ? Read<uint32_t>(guard, mode + 0x10) : 0)
       << ",\"decision\":" << (result ? Read<uint32_t>(guard, result + 0x1378) : 0)
       << ",\"elapsedFrames\":" << (result ? Read<uint32_t>(guard, result + 0x1384) : 0)
       << ",\"remainingFrames\":null,\"players\":[";
  for (uint32_t player = 0; player < 4; player++) {
    const uint32_t initial = mode + 0x98 + player * 0x5c;
    const uint32_t final = result + 0x24 + player * 0x2ac;
    json << (player ? "," : "") << "{\"initial\":" << (relevant ? Read<uint32_t>(guard, initial) : 0)
         << ",\"controller\":" << (relevant ? Read<uint32_t>(guard, initial + 4) : 0)
         << ",\"identity\":" << (relevant ? Read<uint32_t>(guard, final) : 0)
         << ",\"rank\":" << (relevant ? Read<uint32_t>(guard, final + 0xc) : 0)
         << ",\"kos\":" << (relevant ? Read<uint32_t>(guard, final + 0x10) : 0)
         << ",\"falls\":" << (relevant ? Read<uint32_t>(guard, final + 0x14) : 0)
         << ",\"selfDestructs\":" << (relevant ? Read<uint32_t>(guard, final + 0x18) : 0) << "}";
  }
  json << "],\"owners\":[";
  if (playing) {
    const uint32_t manager = Pointer(guard, 0x80b87c48);
    const uint32_t entries = manager ? Pointer(guard, manager) : 0;
    unsigned count = 0;
    for (uint32_t index = 0; entries && index < 7; index++) {
      const uint32_t entry = entries + index * 0x244;
      const uint32_t player = Read<uint32_t>(guard, entry + 0x58);
      if (player >= 4) continue;
      const uint32_t owner = Pointer(guard, entry + 0x28);
      const uint32_t data = owner ? Pointer(guard, owner) : 0;
      if (!data) continue;
      const float damage = Read<float>(guard, data + 0x24);
      json << (count++ ? "," : "") << "{\"playerNo\":" << player
           << ",\"stocks\":" << Read<uint32_t>(guard, data + 0x34) << ",\"damage\":";
      if (std::isfinite(damage) && damage >= 0) json << damage; else json << "null";
      json << "}";
    }
  }
  json << "]}";
  ArcadeBridge::Telemetry(json.str());
}
}
