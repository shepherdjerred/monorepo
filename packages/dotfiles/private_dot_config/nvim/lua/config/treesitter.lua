local M = {}

M.parsers = {
  "bash",
  "c",
  "cpp",
  "css",
  "dockerfile",
  "editorconfig",
  "fish",
  "git_config",
  "git_rebase",
  "gitcommit",
  "go",
  "gomod",
  "gosum",
  "gotmpl",
  "haskell",
  "html",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "luadoc",
  "markdown",
  "markdown_inline",
  "prisma",
  "python",
  "query",
  "regex",
  "rust",
  "sql",
  "terraform",
  "toml",
  "tsx",
  "typescript",
  "vim",
  "vimdoc",
  "xml",
  "yaml",
}

function M.install()
  return require("nvim-treesitter").install(M.parsers, { summary = true })
end

function M.setup()
  require("nvim-treesitter").setup({})
  vim.treesitter.language.register("json", "jsonc")

  local configured = {}
  for _, parser in ipairs(M.parsers) do
    configured[parser] = true
  end

  vim.api.nvim_create_autocmd("FileType", {
    group = vim.api.nvim_create_augroup("ConfiguredTreeSitter", { clear = true }),
    callback = function(args)
      local language = vim.treesitter.language.get_lang(args.match)
      if language and configured[language] then
        vim.treesitter.start(args.buf, language)
      end
    end,
  })
end

return M
