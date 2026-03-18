-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
  vim.fn.system({ "git", "clone", "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git", "--branch=stable", lazypath })
end
vim.opt.rtp:prepend(lazypath)

-- Settings
vim.g.mapleader = " "
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.signcolumn = "yes"
vim.opt.termguicolors = true
vim.opt.clipboard = "unnamedplus"

-- Plugins
require("lazy").setup({
  { "catppuccin/nvim", name = "catppuccin", priority = 1000,
    opts = { flavour = "auto", background = { light = "latte", dark = "mocha" } } },
  { "zbirenbaum/copilot.lua", cmd = "Copilot", event = "InsertEnter",
    opts = { suggestion = { auto_trigger = true, keymap = { accept = "<Tab>" } } } },
  { "nvim-treesitter/nvim-treesitter", build = ":TSUpdate",
    opts = { auto_install = true, highlight = { enable = true } } },
  { "mason-org/mason-lspconfig.nvim",
    opts = {
      automatic_enable = true,
      ensure_installed = {
        "ts_ls", "astro", "rust_analyzer", "pyright", "gopls",
        "lua_ls", "bashls", "jsonls", "yamlls", "html", "cssls",
        "prismals", "terraformls", "kotlin_language_server", "sqlls",
        "clangd", "sourcekit", "hls", "starpls", "dockerls",
        "markdown_oxide", "mdx_analyzer", "taplo",
      },
    },
    dependencies = {
      { "mason-org/mason.nvim", opts = {} },
      "neovim/nvim-lspconfig",
    },
  },
})

-- Apply theme
vim.cmd.colorscheme("catppuccin")

-- LSP completion (built-in)
vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(args)
    vim.lsp.completion.enable(true, args.data.client_id, args.buf)
  end,
})
