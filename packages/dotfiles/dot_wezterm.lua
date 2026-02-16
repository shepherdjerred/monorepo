-- Pull in the wezterm API
local wezterm = require 'wezterm'

function get_appearance()
  if wezterm.gui then
    return wezterm.gui.get_appearance()
  end
  return 'Dark'
end

-- This will hold the configuration.
local config = wezterm.config_builder()

config.font = wezterm.font_with_fallback {
  'Berkeley Mono',
  'Symbols Nerd Font Mono',
}
config.font_size = 13.0
config.use_fancy_tab_bar = false

function scheme_for_appearance(appearance)
  if appearance:find 'Dark' then
    return 'Catppuccin Mocha'
  else
    return 'Catppuccin Latte'
  end
end

config.color_scheme = scheme_for_appearance(get_appearance())

-- and finally, return the configuration to wezterm
config.keys = {
  {key="Enter", mods="SHIFT", action=wezterm.action{SendString="\x1b\r"}},
}

return config
