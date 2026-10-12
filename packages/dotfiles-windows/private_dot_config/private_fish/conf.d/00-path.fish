# Runs before plugin conf.d files. Non-login shells started from Windows
# (`fish -i`) inherit only the Windows PATH, so put the MSYS2 tools first.
fish_add_path /usr/bin ~/.local/bin (/usr/bin/cygpath -u "$LOCALAPPDATA/mise/shims")
