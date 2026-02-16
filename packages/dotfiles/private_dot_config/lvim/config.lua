-- Read the docs: https://www.lunarvim.org/docs/configuration
-- Example configs: https://github.com/LunarVim/starter.lvim
-- Video Tutorials: https://www.youtube.com/watch?v=sFA9kX-Ud_c&list=PLhoH5vyxr6QqGu0i7tt_XoVK9v-KvZ3m6
-- Forum: https://www.reddit.com/r/lunarvim/
-- Discord: https://discord.com/invite/Xb9B4Ny

table.insert(lvim.plugins, {
  "zbirenbaum/copilot.lua",
  cmd = "Copilot",
  event = "InsertEnter",
  config = function()
    require("copilot").setup({})
  end,
})

table.insert(lvim.plugins, {
  "zbirenbaum/copilot-cmp",
  config = function ()
    require("copilot_cmp").setup()
  end
})

table.insert(lvim.plugins, {
  "catppuccin/nvim",
  name = "catppuccin",
  priority = 1000,
  config = function()
    require("catppuccin").setup({
      flavour = "auto",
      background = { light = "latte", dark = "mocha" },
    })
    vim.cmd.colorscheme "catppuccin"
  end,
})

-- Disable treesitter indent to work around Neovim 0.11.x compatibility issue
lvim.builtin.treesitter.indent = { enable = false }
lvim.builtin.indentlines.options.use_treesitter = false
lvim.builtin.indentlines.options.show_current_context = false
