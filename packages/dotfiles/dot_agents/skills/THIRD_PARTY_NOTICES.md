# Third-party skill notices

The repository-owned skill tree is the source of truth. The entries below are
public content that was adapted or vendored into it and must be reviewed
manually before an upstream update. Exact commits and local paths are recorded
in [`public-sources.json`](public-sources.json).

## HashiCorp agent-skills

- Source: <https://github.com/hashicorp/agent-skills/tree/4451ceca5456e79cc776efee96a744f7ac96e5bf>
- License: Mozilla Public License 2.0 (MPL-2.0); the applicable license text is
  retained at `third-party-licenses/hashicorp-agent-skills.MPL-2.0`.
- Integrated content: selected Terraform style, test, module, import, policy,
  and provider-development workflows and references. Packer and unrelated
  Azure-specific skills were excluded.

## Tailscale skill

- Source: <https://github.com/tailscale/tailscale-skill/tree/4f05d353efc56962546aa26ccc59bb08ca699ad1>
- License: BSD 3-Clause; the applicable license text is retained at
  `third-party-licenses/tailscale-skill.BSD-3-Clause`.
- Integrated content: adapted product/reference material only. The upstream
  project describes itself as Alpha; local authentication, live-state, Serve,
  Funnel, and homelab rules remain authoritative.

## Vercel agent-skills

- Source: <https://github.com/vercel-labs/agent-skills/tree/b8caa260a420a73042e35521de4b5c8baf6446cc>
- License: MIT (as stated by the upstream project; the project did not include a
  license file at this pinned commit).
- Integrated content: adapted `web-design-guidelines` and the upstream
  `react-native-skills` directory under the local name `react-native-guidelines`;
  selected React performance guidance was adapted into `vite-react-helper`.
  Vercel deployment and optimization workflows were excluded.

## Cloudflare security-audit-skill

- Source: <https://github.com/cloudflare/security-audit-skill/tree/8bac42001ddd90a4dcd8d5a5045199283a8eba75>
- License: MIT; the applicable license text is retained at
  `third-party-licenses/cloudflare-security-audit.MIT`.
- Integrated content: vendored `security-audit`, including its six-phase
  workflow, references, `report-schema.json`, and `validate-findings.cjs`.

The Swift community skill repository was intentionally not copied because its
PolyForm Perimeter license is not suitable for this public skill SOT.
