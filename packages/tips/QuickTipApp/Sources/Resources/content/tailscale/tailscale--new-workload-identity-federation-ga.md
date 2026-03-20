---
app: Tailscale
icon: network
color: "#2D5BE4"
website: https://tailscale.com
category: New Features
---

- Workload identity federation (GA) lets CI/CD pipelines, cloud workloads, and Kubernetes pods authenticate to the Tailscale API using their native OIDC identity tokens, with no long-lived secrets required
- Supported providers include GitHub Actions, GitLab CI, Terraform, and Kubernetes service accounts, so your automation can join a tailnet or call the API without managing auth keys
- The Tailscale Terraform provider, tailscale-client-go-v2 library, and the Tailscale GitHub Action all support workload identity federation natively
- Federated identity token exchange errors are shown on the Trust credentials page in the admin console to help with debugging
