# Bun workspace release lifecycle

Read this when upgrading Bun package management, changing linker defaults, or adopting the experimental global store.

## Current version

Bun 1.3.14 is current as of 2026-08-03. New workspace linker defaults depend on the lockfile configuration introduced in 1.3.2, not only the installed binary.

## Research ledger

The following 49 authoritative pages were fetched and inspected:

1. [Workspaces](https://bun.com/docs/pm/workspaces.md)
2. [Catalogs](https://bun.com/docs/pm/catalogs.md)
3. [Isolated installs](https://bun.com/docs/pm/isolated-installs.md)
4. [Filters](https://bun.com/docs/pm/filter.md)
5. [Lockfile](https://bun.com/docs/pm/lockfile.md)
6. [Lifecycle](https://bun.com/docs/pm/lifecycle.md)
7. [Global cache](https://bun.com/docs/pm/global-cache.md)
8. [Global store](https://bun.com/docs/pm/global-store.md)
9. [Overrides](https://bun.com/docs/pm/overrides.md)
10. [Scopes and registries](https://bun.com/docs/pm/scopes-registries.md)
11. [.npmrc](https://bun.com/docs/pm/npmrc.md)
12. [bunfig](https://bun.com/docs/runtime/bunfig.md)
13. [Install](https://bun.com/docs/pm/cli/install.md)
14. [Add](https://bun.com/docs/pm/cli/add.md)
15. [Remove](https://bun.com/docs/pm/cli/remove.md)
16. [Update](https://bun.com/docs/pm/cli/update.md)
17. [Outdated](https://bun.com/docs/pm/cli/outdated.md)
18. [Link](https://bun.com/docs/pm/cli/link.md)
19. [PM utilities](https://bun.com/docs/pm/cli/pm.md)
20. [Patch](https://bun.com/docs/pm/cli/patch.md)
21. [Publish](https://bun.com/docs/pm/cli/publish.md)
22. [Audit](https://bun.com/docs/pm/cli/audit.md)
23. [Info](https://bun.com/docs/pm/cli/info.md)
24. [Why](https://bun.com/docs/pm/cli/why.md)
25. [Workspace guide](https://bun.com/docs/guides/install/workspaces.md)
26. [npm-to-Bun migration](https://bun.com/docs/guides/install/from-npm-install-to-bun-install.md)
27. [Add peer](https://bun.com/docs/guides/install/add-peer.md)
28. [Add optional](https://bun.com/docs/guides/install/add-optional.md)
29. [Trusted dependencies](https://bun.com/docs/guides/install/trusted.md)
30. [Install CI/CD](https://bun.com/docs/guides/install/cicd.md)
31. [Runtime CI/CD](https://bun.com/docs/guides/runtime/cicd.md)
32. [Yarn lockfile](https://bun.com/docs/guides/install/yarnlock.md)
33. [Custom registry](https://bun.com/docs/guides/install/custom-registry.md)
34. [Registry scope](https://bun.com/docs/guides/install/registry-scope.md)
35. [Docker](https://bun.com/docs/guides/ecosystem/docker.md)
36. [Module resolution](https://bun.com/docs/runtime/module-resolution.md)
37. [Auto-install](https://bun.com/docs/runtime/auto-install.md)
38. [Documentation inventory](https://bun.com/docs/llms.txt)
39. [Latest Bun release](https://github.com/oven-sh/bun/releases/latest)
40. [Bun 1.3.14](https://bun.com/blog/bun-v1.3.14)
41. [Bun 1.3.2](https://bun.com/blog/bun-v1.3.2)
42. [Text lockfile](https://bun.com/blog/bun-lock-text-lockfile)
43. [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
44. [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
45. [TypeScript moduleResolution](https://www.typescriptlang.org/tsconfig/moduleResolution.html)
46. [TypeScript skipLibCheck](https://www.typescriptlang.org/tsconfig/skipLibCheck.html)
47. [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
48. [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
49. [Build cache optimization](https://docs.docker.com/build/cache/optimize/)
