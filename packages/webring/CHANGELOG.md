# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0](https://github.com/shepherdjerred/webring/compare/v1.4.1...v1.5.0) (2026-01-20)


### Features

* add Plausible analytics to TypeDoc docs ([e416ae6](https://github.com/shepherdjerred/webring/commit/e416ae678886112973910f819fe2062c027043b4))


### Bug Fixes

* use customJs instead of invalid customHead option for Plausible ([4c7b1d7](https://github.com/shepherdjerred/webring/commit/4c7b1d733d90ef8c94448fe5ece9d0141ee9ef24))

## [1.4.1](https://github.com/shepherdjerred/webring/compare/v1.4.0...v1.4.1) (2026-01-19)


### Bug Fixes

* allow PR CI runs to execute in parallel ([67e8744](https://github.com/shepherdjerred/webring/commit/67e8744549135c07d810fe731731fb0463bea897))
* **deps:** update dependency @shepherdjerred/dagger-utils to ^0.5.0 ([#144](https://github.com/shepherdjerred/webring/issues/144)) ([df51479](https://github.com/shepherdjerred/webring/commit/df51479c06de3346e070af36ca5ac0db16d37111))
* **deps:** update dependency @shepherdjerred/dagger-utils to ^0.6.0 ([0d07e82](https://github.com/shepherdjerred/webring/commit/0d07e8263786b271495a68b0c9b9adb1cf169a3a))
* skip lifecycle scripts during npm publish in Dagger CI ([336100b](https://github.com/shepherdjerred/webring/commit/336100baaf908cbb7c8cab772932aef8a4ece33a))
* use bun publish instead of npm publish in Dagger CI ([3a090d1](https://github.com/shepherdjerred/webring/commit/3a090d101ebfc6d778c065805a4cfe74bb0cac35))

## [1.4.0](https://github.com/shepherdjerred/webring/compare/v1.3.8...v1.4.0) (2026-01-04)


### Features

* add automatic homelab deployment for docs ([#153](https://github.com/shepherdjerred/webring/issues/153)) ([7b7b365](https://github.com/shepherdjerred/webring/commit/7b7b365f6667266f353b81d24288a2bdcfe2b381))
* add Docker Hub authentication to CI workflow ([d6801a7](https://github.com/shepherdjerred/webring/commit/d6801a7a8eb83a99ccee1148efba7d39637dcd59))
* consolidate workflows into single Dagger call ([a36787e](https://github.com/shepherdjerred/webring/commit/a36787eb9b572a5898a844ad57212590149925bf))
* migrate docs from GitHub Pages to K8s ([1f9c1d5](https://github.com/shepherdjerred/webring/commit/1f9c1d573f1ff329456f43ceca2b20fb76f023a6))
* migrate docs from GitHub Pages to K8s ([e9c6510](https://github.com/shepherdjerred/webring/commit/e9c6510150d2fa701765399e830b89d02c3099ce))
* migrate to dagger ([b710a50](https://github.com/shepherdjerred/webring/commit/b710a508316a4ed4f0eb78a53a7b78fdc39fbe27))


### Bug Fixes

* add [@dagger](https://github.com/dagger).io/dagger as file link to ./sdk for runtime resolution ([1262b32](https://github.com/shepherdjerred/webring/commit/1262b32c71d2ad0af69420e8aa523729ec78100b))
* add missing [@dagger](https://github.com/dagger).io/dagger dependency and remove yarn ([4e2b8f5](https://github.com/shepherdjerred/webring/commit/4e2b8f5e4524e1c381e1bc87b8c57d86dde9b21f))
* add npm overrides to ensure [@dagger](https://github.com/dagger).io/dagger resolution ([9afb7c0](https://github.com/shepherdjerred/webring/commit/9afb7c0a3bbb22b7eb4010462f35cac320b09125))
* add package.json to sdk directory for module resolution ([7ce7dfc](https://github.com/shepherdjerred/webring/commit/7ce7dfca979fb9571a9abad23b27d11bccd73562))
* add postinstall script to create index.js shim for [@dagger](https://github.com/dagger).io/dagger ([44ce92b](https://github.com/shepherdjerred/webring/commit/44ce92b757edf51bf293556a5f46ad101e03a777))
* avoid recursive symlinks in example test ([06a9893](https://github.com/shepherdjerred/webring/commit/06a9893afdea689a477e94075afe49acaa06495f))
* completely remove webring line from package.json instead of replacing ([486fe3c](https://github.com/shepherdjerred/webring/commit/486fe3cc9b79324ef2f7eaeef057bd68c274b7a7))
* configure vitest deps resolution for Bun compatibility ([3b11f29](https://github.com/shepherdjerred/webring/commit/3b11f298b41f16b51d83c270a53b6c8737b53c40))
* configure vitest to use forks pool for Bun compatibility ([d61553b](https://github.com/shepherdjerred/webring/commit/d61553b1eb535ad9f0bc8adbf8d79ef323f6a5b9))
* **dagger:** prevent symlink creation by modifying package.json before install ([d467084](https://github.com/shepherdjerred/webring/commit/d4670842dceb10ef1ffe720bf8e63f4e81dd06c7))
* **deps:** update npm ([062f2e2](https://github.com/shepherdjerred/webring/commit/062f2e221fcef299a16975753965703ae6143b39))
* install [@dagger](https://github.com/dagger).io/dagger from npm instead of local sdk ([7cea8e9](https://github.com/shepherdjerred/webring/commit/7cea8e9c4b22f6fc6f84639c9fe8f861467a800c))
* only export artifacts in prod mode ([d285067](https://github.com/shepherdjerred/webring/commit/d285067ed36ca3ea645617e31e138a9d9b3c18e1))
* preserve dist/ directory structure when copying webring package ([6d94114](https://github.com/shepherdjerred/webring/commit/6d941141e4f05354f69bd8a386ea9c3b0e979905))
* regenerate dagger module with dagger develop ([772beb5](https://github.com/shepherdjerred/webring/commit/772beb59b9ed8910dc285e68c259d861676100e3))
* remove double-default access on truncate-html import ([2ec053c](https://github.com/shepherdjerred/webring/commit/2ec053c7d4a6cc9ce186285b539bf2a009e4555b))
* remove double-default access on truncate-html import ([53cf8d4](https://github.com/shepherdjerred/webring/commit/53cf8d4a0e9f17e38d09dfd914906fb537fc966e))
* remove tsconfig paths to use npm [@dagger](https://github.com/dagger).io/dagger ([daa8417](https://github.com/shepherdjerred/webring/commit/daa84175797cdd40dc639308384d9fe1db257cdd))
* specify npm as package manager for Dagger runtime ([45b7ca5](https://github.com/shepherdjerred/webring/commit/45b7ca5dd65dc78721c2a0d09689b4cc4b378730))
* update CI workflow to use Bun instead of Node/npm ([b570030](https://github.com/shepherdjerred/webring/commit/b570030e180aa37b2c57d0ffb66ecb3bd5c937df))
* update dagger engine version to v0.19.8 ([02d2cc5](https://github.com/shepherdjerred/webring/commit/02d2cc57d229c668d1f64e637b090385b680d023))
* update snapshots ([faee9ab](https://github.com/shepherdjerred/webring/commit/faee9abb585c490312c9c6f0235083ddbaed126b))
* update test snapshots after truncate fix ([c556621](https://github.com/shepherdjerred/webring/commit/c556621f6053aa82fafcae8ff2b508abf0457ab4))
* use --legacy-peer-deps for npm ci in dagger module ([8c182a3](https://github.com/shepherdjerred/webring/commit/8c182a3c8a25ec29fd08ee7fe24b9cfa1540a856))
* use **/node_modules to prevent symlink recursion in Dagger ([db08167](https://github.com/shepherdjerred/webring/commit/db081672998b50014add9c3367ea5b2e6a8639c6))
* use Bun runtime for Dagger module to fix ESM resolution ([8debdae](https://github.com/shepherdjerred/webring/commit/8debdae9d9011bd0a8d83d48bfdd18c89a9deadc))
* use bun to properly remove webring from package.json ([7703402](https://github.com/shepherdjerred/webring/commit/7703402f3ca7f05ac7421e3c6cfe2934967e13b1))
* use correct 1Password vault/item UUIDs ([ab829d9](https://github.com/shepherdjerred/webring/commit/ab829d98c86d2c2bd86a7d4c047ccd78927806e9))
* use explicit version in npm overrides ([05b41da](https://github.com/shepherdjerred/webring/commit/05b41da8cf4b79d8588c4731a890cae819be4cc6))
* use forks pool with inline deps for vitest/Bun compat ([5f5ef3b](https://github.com/shepherdjerred/webring/commit/5f5ef3b3ce44c4c480ea84788f1e83579e0cbed5))
* use GH_TOKEN from 1Password for GitHub API access ([6d6b453](https://github.com/shepherdjerred/webring/commit/6d6b453dff1889ed2965c100b28c941895fa3900))
* use GITHUB_TOKEN for GHCR push with packages:write permission ([#154](https://github.com/shepherdjerred/webring/issues/154)) ([377b42b](https://github.com/shepherdjerred/webring/commit/377b42bbe8e44586cd8a806d4334af85638e79d3))
* use latest Bun version in Dagger container ([bb7a8d9](https://github.com/shepherdjerred/webring/commit/bb7a8d91f7bd0006c9d224aabbb67bb5d62b83c9))
* use threads pool with inline deps for vitest/Bun compat ([6bb3bd9](https://github.com/shepherdjerred/webring/commit/6bb3bd9dba1f755becdc2abaa2cb44d5912f497f))
* use UUID-based 1Password refs and hardcode connect host ([68536fd](https://github.com/shepherdjerred/webring/commit/68536fdd37ae18fa8a7089976b4503b333cd77f0))
* use vmThreads pool and inline zod for vitest ([0928c75](https://github.com/shepherdjerred/webring/commit/0928c75e8b67759cd47165a578694335e64a77ba))


### Reverts

* remove Docker Hub authentication from CI workflow ([dca8829](https://github.com/shepherdjerred/webring/commit/dca8829c2e654525d5ab757e6501398ee5e2b12d))

## [1.3.8](https://github.com/shepherdjerred/webring/compare/v1.3.7...v1.3.8) (2025-06-15)


### Bug Fixes

* **deps:** update dependency remeda to v2.23.0 ([885dcab](https://github.com/shepherdjerred/webring/commit/885dcab7ce39c157691c30a8906b913fc33a7a8c))
* **deps:** update npm ([46bf808](https://github.com/shepherdjerred/webring/commit/46bf8086abbfb640a023d5e0a51215e5dca2c558))
* **deps:** update npm ([68e3961](https://github.com/shepherdjerred/webring/commit/68e39618b1efe32211e0c87a960decd6eb199c26))
* **deps:** update npm ([7f024c1](https://github.com/shepherdjerred/webring/commit/7f024c1012df5619590e6fb0463fd8248ad7ee79))

## [1.3.7](https://github.com/shepherdjerred/webring/compare/v1.3.6...v1.3.7) (2025-03-23)


### Bug Fixes

* **deps:** update npm ([e4ad27b](https://github.com/shepherdjerred/webring/commit/e4ad27beb087db3c69c8311249adb0177497aad4))
* **deps:** update npm ([901ef78](https://github.com/shepherdjerred/webring/commit/901ef784edd954f2d8f4f4006e641228f6a4136b))
* linter ([f2de46f](https://github.com/shepherdjerred/webring/commit/f2de46f19a7ef31f77e0c41fadae7ceb6bddfb02))

## [1.3.6](https://github.com/shepherdjerred/webring/compare/v1.3.5...v1.3.6) (2025-03-13)


### Bug Fixes

* **deps:** update npm ([c7b5e43](https://github.com/shepherdjerred/webring/commit/c7b5e43745953843d8a8ab546fc1cfba661f42f9))
* **deps:** update npm ([5638a30](https://github.com/shepherdjerred/webring/commit/5638a30f1844275ad758efde5bbfb2e0b2ced6f7))
* update ([c4235ba](https://github.com/shepherdjerred/webring/commit/c4235bab76aa3d5b7000067f5a1d9b7025cf9db0))
* update example ([d8da6ec](https://github.com/shepherdjerred/webring/commit/d8da6ecc17e05b0081a0346d851dc243e23f9b5f))

## [1.3.5](https://github.com/shepherdjerred/webring/compare/v1.3.4...v1.3.5) (2025-01-19)


### Bug Fixes

* **deps:** update npm ([f262f16](https://github.com/shepherdjerred/webring/commit/f262f16c2d2b887f06196b1fe146cf3845adf604))

## [1.3.4](https://github.com/shepherdjerred/webring/compare/v1.3.3...v1.3.4) (2025-01-12)


### Bug Fixes

* **deps:** update npm ([4b6fc1c](https://github.com/shepherdjerred/webring/commit/4b6fc1cdba5478315c89b7cd3b42ecc3bfe734a2))

## [1.3.3](https://github.com/shepherdjerred/webring/compare/v1.3.2...v1.3.3) (2025-01-05)


### Bug Fixes

* **deps:** update npm ([5f888c1](https://github.com/shepherdjerred/webring/commit/5f888c1feb95c30b5b2fd3b7d98cbad273309d3f))

## [1.3.2](https://github.com/shepherdjerred/webring/compare/v1.3.1...v1.3.2) (2024-12-29)


### Bug Fixes

* **deps:** update npm ([40bc40e](https://github.com/shepherdjerred/webring/commit/40bc40ea5fecfb69c0839fa5b97f577ad9dd6208))

## [1.3.1](https://github.com/shepherdjerred/webring/compare/v1.3.0...v1.3.1) (2024-12-22)


### Bug Fixes

* **deps:** update npm ([3eaac2e](https://github.com/shepherdjerred/webring/commit/3eaac2e4513fb2f7574b5080d7d5851c9bac365e))

## [1.3.0](https://github.com/shepherdjerred/webring/compare/v1.2.7...v1.3.0) (2024-12-20)


### Features

* use Earthly for CI ([f724d1a](https://github.com/shepherdjerred/webring/commit/f724d1a9c1d44e2be19d78751e205ad70e6802b7))


### Bug Fixes

* **deps:** update dependency astro to v5.0.8 [security] ([85e2e23](https://github.com/shepherdjerred/webring/commit/85e2e23f30f6201ee86a8fd535c5ce743e75722e))
* reviewer ([d216b08](https://github.com/shepherdjerred/webring/commit/d216b0874c13b095ae8b0931126724293c869fc4))

## [1.2.7](https://github.com/shepherdjerred/webring/compare/v1.2.6...v1.2.7) (2024-12-08)


### Bug Fixes

* **deps:** update npm ([6e02795](https://github.com/shepherdjerred/webring/commit/6e02795b6c803c8c67b8e61e6e03af29f490a60d))
* **deps:** update npm ([05d3700](https://github.com/shepherdjerred/webring/commit/05d3700a5433240bb8c68ef2c197fbc50ca4d1eb))

## [1.2.6](https://github.com/shepherdjerred/webring/compare/v1.2.5...v1.2.6) (2024-11-10)


### Bug Fixes

* **deps:** update npm ([7b71504](https://github.com/shepherdjerred/webring/commit/7b71504c3ce69ea864b6c5bf73cf2b31fd788c43))
* **deps:** update npm ([9b94976](https://github.com/shepherdjerred/webring/commit/9b949767047bef2857a46fa7aa1e378f5d29bed3))
* **deps:** update npm ([0bc16d4](https://github.com/shepherdjerred/webring/commit/0bc16d484f398546aa98b3236fe775c36ee35188))

## [1.2.5](https://github.com/shepherdjerred/webring/compare/v1.2.4...v1.2.5) (2024-10-05)


### Bug Fixes

* update cheerio ([912c4c0](https://github.com/shepherdjerred/webring/commit/912c4c0d74c0e731b6e4a42e621844978b0514c5))
* update renovate ([e99d849](https://github.com/shepherdjerred/webring/commit/e99d849756ded9df52b6a7921b4b14141d669efc))

## [1.2.4](https://github.com/shepherdjerred/webring/compare/v1.2.3...v1.2.4) (2024-10-05)


### Bug Fixes

* update package-lock of example ([65e28ca](https://github.com/shepherdjerred/webring/commit/65e28caead9615f93791616804bf21a14b29cca7))

## [1.2.3](https://github.com/shepherdjerred/webring/compare/v1.2.2...v1.2.3) (2024-10-05)


### Bug Fixes

* **deps:** update npm ([26ff336](https://github.com/shepherdjerred/webring/commit/26ff336928c60270340b2cb763d84e43465001ff))

## [1.2.2](https://github.com/shepherdjerred/webring/compare/v1.2.1...v1.2.2) (2024-09-13)


### Bug Fixes

* **deps:** update npm ([b0e54f4](https://github.com/shepherdjerred/webring/commit/b0e54f4f0d9428c14cbbfa69b4654b9a09d70368))

## [1.2.1](https://github.com/shepherdjerred/webring/compare/v1.2.0...v1.2.1) (2024-08-12)


### Bug Fixes

* deps ([ba13fdb](https://github.com/shepherdjerred/webring/commit/ba13fdbd0420d03049a713b6901fb236eb409cac))
* revert cheerio ([0b71e1e](https://github.com/shepherdjerred/webring/commit/0b71e1e2be61853c8ca99a614d7c2095969493c2))

## [1.2.0](https://github.com/shepherdjerred/webring/compare/v1.1.4...v1.2.0) (2024-08-12)


### Features

* add ability to filter and shuffle ([51dcc9d](https://github.com/shepherdjerred/webring/commit/51dcc9d946ed0bee2f854cf5249d8cd9680e1bc6))
* update to eslint 9 ([7721ac1](https://github.com/shepherdjerred/webring/commit/7721ac190acfdabfd7b6ece3019c018a05700336))


### Bug Fixes

* **deps:** update npm ([27dd6e3](https://github.com/shepherdjerred/webring/commit/27dd6e3e96be57ad3093e494234e3ba2d790494c))

## [1.1.4](https://github.com/shepherdjerred/webring/compare/v1.1.3...v1.1.4) (2024-07-28)


### Bug Fixes

* **deps:** update npm ([561215f](https://github.com/shepherdjerred/webring/commit/561215f065d07c46771283e060543dca445017d2))
* **deps:** update npm ([e6c89bc](https://github.com/shepherdjerred/webring/commit/e6c89bcb0d92a5680e31ef9d606ee5d8b21664f1))

## [1.1.3](https://github.com/shepherdjerred/webring/compare/v1.1.2...v1.1.3) (2024-07-14)


### Bug Fixes

* don't include test files in package ([52d0861](https://github.com/shepherdjerred/webring/commit/52d0861922068273d358c4297fa644cfc8d3e54d))

## [1.1.2](https://github.com/shepherdjerred/webring/compare/v1.1.1...v1.1.2) (2024-07-14)


### Bug Fixes

* **deps:** update npm ([bfaf883](https://github.com/shepherdjerred/webring/commit/bfaf88347ae769e00e93e514774b2c760694f902))

## [1.1.1](https://github.com/shepherdjerred/webring/compare/v1.1.0...v1.1.1) (2024-07-07)


### Bug Fixes

* **deps:** update dependency astro to v4.11.5 ([a61f733](https://github.com/shepherdjerred/webring/commit/a61f733cbd3f7bd659d4a608f58473885a5bcc61))
* **deps:** update dependency remeda to v2.2.2 ([97a6c06](https://github.com/shepherdjerred/webring/commit/97a6c064138e0c204e231efb2ca45defd82b61f9))
* **deps:** update dependency remeda to v2.3.0 ([7a4c8d5](https://github.com/shepherdjerred/webring/commit/7a4c8d51ad5722be0a8dced10eb0b14a279b0bf6))
* update snapshot ([c73cdf7](https://github.com/shepherdjerred/webring/commit/c73cdf779433e6e7e8c5f2beee3fb2aefec9a0e0))
* use import instead of triple-slash ([971a77e](https://github.com/shepherdjerred/webring/commit/971a77ecd0c612850faeb9d16f7775d3e7ca7253))

## [1.1.0](https://github.com/shepherdjerred/webring/compare/v1.0.3...v1.1.0) (2024-06-28)


### Features

* source mappings ([095fe2b](https://github.com/shepherdjerred/webring/commit/095fe2be44e25547271730a5611d4710609cdf8d))

## [1.0.3](https://github.com/shepherdjerred/webring/compare/v1.0.2...v1.0.3) (2024-06-24)


### Bug Fixes

* create dir to cache ([a30645c](https://github.com/shepherdjerred/webring/commit/a30645c11d2afe91f7802c91b2c82eef9a97c717))

## [1.0.2](https://github.com/shepherdjerred/webring/compare/v1.0.1...v1.0.2) (2024-06-21)


### Bug Fixes

* disable style parsing ([0999f02](https://github.com/shepherdjerred/webring/commit/0999f025b4e9970a20bde8c1ffce1248ce38f3b7))

## [1.0.1](https://github.com/shepherdjerred/webring/compare/v1.0.0...v1.0.1) (2024-06-03)


### Bug Fixes

* add tests, fix import ([3f811a1](https://github.com/shepherdjerred/webring/commit/3f811a18fae9186795f5d34cb0d4bbdd20f2a5df))

## [1.0.0](https://github.com/shepherdjerred/webring/compare/v0.3.0...v1.0.0) (2024-06-03)


### ⚠ BREAKING CHANGES

* add link

### Documentation

* add link ([1a5d327](https://github.com/shepherdjerred/webring/commit/1a5d327a002785809e84aab70b19d18dd135f78b))

## [0.3.0](https://github.com/shepherdjerred/webring/compare/v0.2.0...v0.3.0) (2024-06-03)

### Features

- allow filename to be configurable ([cc7bb5f](https://github.com/shepherdjerred/webring/commit/cc7bb5f3139f306952d03568fc63cc9fcbfaad5e))
