function with-anthropic --description 'Run an external command with the workstation Anthropic API credential'
    if not set -q argv[1]
        echo 'Usage: with-anthropic <command> [args...]' >&2
        return 2
    end

    set -l source_dir (chezmoi source-path)
    or return
    command "$source_dir/../../scripts/onepassword/with-service-account.sh" \
        op run --env-file "$__fish_config_dir/anthropic.env.example" -- \
        /usr/bin/env -u OP_SERVICE_ACCOUNT_TOKEN -- $argv
end
