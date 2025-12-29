"""
Auth-injecting proxy for Claude Code containers.

Runs on host, injects credentials based on destination.
Container has zero credentials - only the proxy has secrets.
"""

import os
from mitmproxy import http, ctx


# Credential injection rules: (host_pattern, header_name, env_var)
RULES: list[tuple[str, str, str]] = [
    # GitHub
    ("api.github.com", "Authorization", "GITHUB_TOKEN"),
    ("github.com", "Authorization", "GITHUB_TOKEN"),

    # Claude / Anthropic
    ("api.anthropic.com", "x-api-key", "ANTHROPIC_API_KEY"),

    # PagerDuty
    ("api.pagerduty.com", "Authorization", "PAGERDUTY_TOKEN"),

    # Sentry
    ("sentry.io", "Authorization", "SENTRY_AUTH_TOKEN"),

    # Additional services can be added here
    # ("api.example.com", "Authorization", "EXAMPLE_TOKEN"),
]

# Services that need special header formatting
HEADER_FORMATTERS: dict[str, callable] = {
    "GITHUB_TOKEN": lambda t: f"Bearer {t}" if not t.startswith(("Bearer ", "token ")) else t,
    "PAGERDUTY_TOKEN": lambda t: f"Token token={t}" if not t.startswith("Token ") else t,
    "SENTRY_AUTH_TOKEN": lambda t: f"Bearer {t}" if not t.startswith("Bearer ") else t,
    "ANTHROPIC_API_KEY": lambda t: t,  # x-api-key is just the raw key
}


def get_credential(env_var: str) -> str | None:
    """Get credential from environment, with optional formatting."""
    value = os.environ.get(env_var)
    if value and env_var in HEADER_FORMATTERS:
        value = HEADER_FORMATTERS[env_var](value)
    return value


class AuthInjector:
    def request(self, flow: http.HTTPFlow) -> None:
        host = flow.request.host

        for host_pattern, header_name, env_var in RULES:
            if host_pattern in host:
                credential = get_credential(env_var)
                if credential:
                    # Don't override if already present (allows container to use different creds if needed)
                    if header_name not in flow.request.headers:
                        flow.request.headers[header_name] = credential
                        ctx.log.info(f"Injected {header_name} for {host} (from {env_var})")
                    else:
                        ctx.log.debug(f"Skipped injection for {host} - header already present")
                else:
                    ctx.log.warn(f"No credential found for {host} (missing {env_var})")
                break


addons = [AuthInjector()]
