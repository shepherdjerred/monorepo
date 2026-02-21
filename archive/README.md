# Archive

Archived personal projects - completed, abandoned, or superseded.

<!--[[[cog
import cog
import subprocess
import pathlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone

MODEL = "gpt-5-codex"
GITHUB_URL = "https://github.com/shepherdjerred/monorepo/tree/main/archive"
TECH_KEYWORDS = (
    "typescript", "javascript", "bun", "node", "react", "vite", "astro", "hono",
    "rust", "tokio", "python", "go", "java", "kotlin", "prisma", "sqlite",
    "postgres", "docker", "kubernetes", "aws", "cloudflare", "discord"
)
BANNED_PHRASES = (
    "i do not have enough information",
    "there is only",
    "appears to be",
    "likely",
    "possibly",
    "might",
    "suggests",
    "probably",
    "cannot access any project details",
)

def read_file_excerpt(path, max_chars=2000):
    try:
        return path.read_text(errors="ignore")[:max_chars]
    except Exception:
        return ""

def gather_source_context(folder_path, max_chars=14000):
    """Gather context from source files when no README exists."""
    context_parts = []

    # Prefer the project's own README when available.
    readme_text = read_file_excerpt(folder_path / "README.md", 3000)
    if readme_text:
        context_parts.append(f"README.md:\n{readme_text}")

    # Check package.json
    pkg_json = folder_path / "package.json"
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text())
            context_parts.append(
                "package.json:\n"
                f"name={pkg.get('name')}\n"
                f"description={pkg.get('description')}\n"
                f"scripts={list(pkg.get('scripts', {}).keys())[:12]}\n"
                f"dependencies={list(pkg.get('dependencies', {}).keys())[:20]}"
            )
        except Exception:
            pass

    # Check Cargo.toml
    cargo_toml = folder_path / "Cargo.toml"
    if cargo_toml.exists():
        context_parts.append(f"Cargo.toml:\n{read_file_excerpt(cargo_toml, 1400)}")

    # Check pyproject.toml
    pyproject = folder_path / "pyproject.toml"
    if pyproject.exists():
        context_parts.append(f"pyproject.toml:\n{read_file_excerpt(pyproject, 1400)}")

    # Pull representative source files from common roots.
    code_exts = {".ts", ".tsx", ".js", ".jsx", ".rs", ".py", ".go", ".java", ".kt", ".swift", ".rb", ".sh"}
    skip_dirs = {"node_modules", "dist", "build", "target", ".git", "vendor", ".next", ".turbo"}
    source_roots = ["src", "app", "api", "web", "core", "cli"]
    collected = 0

    for root in source_roots:
        root_path = folder_path / root
        if not root_path.exists() or not root_path.is_dir():
            continue
        for fp in sorted(root_path.rglob("*")):
            if collected >= 6:
                break
            if not fp.is_file():
                continue
            if any(part in skip_dirs for part in fp.parts):
                continue
            if fp.suffix.lower() not in code_exts:
                continue
            rel = fp.relative_to(folder_path)
            context_parts.append(f"{rel}:\n{read_file_excerpt(fp, 1400)}")
            collected += 1
        if collected >= 6:
            break

    # List directory structure
    try:
        files = [f.name for f in folder_path.iterdir() if not f.name.startswith('.')][:30]
        context_parts.append(f"Files: {', '.join(files)}")
    except Exception:
        pass

    return "\n\n".join(context_parts)[:max_chars]

def summary_has_quality(summary):
    text = summary.strip()
    if len(text) < 170:
        return False
    lower = text.lower()
    if any(phrase in lower for phrase in BANNED_PHRASES):
        return False
    if len([s for s in re.split(r"[.!?]+", text) if s.strip()]) < 2:
        return False
    if not any(keyword in lower for keyword in TECH_KEYWORDS):
        return False
    return True

def generate_summary(content, prompt, summary_path):
    """Generate summary using Codex CLI and cache it."""
    schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "confidence": {"type": "number"},
            "tech": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["summary", "confidence", "tech"],
        "additionalProperties": False,
    }
    full_prompt = f"{prompt}\n\nProject context:\n{content}"

    with tempfile.TemporaryDirectory() as tmpdir:
        schema_path = pathlib.Path(tmpdir) / "schema.json"
        out_path = pathlib.Path(tmpdir) / "summary.json"
        schema_path.write_text(json.dumps(schema))

        env = dict(os.environ)
        if env.get("OPENAI_API_KEY") and not env.get("CODEX_API_KEY"):
            env["CODEX_API_KEY"] = env["OPENAI_API_KEY"]

        result = subprocess.run(
            [
                "bunx",
                "@openai/codex",
                "exec",
                "--model",
                MODEL,
                "--sandbox",
                "read-only",
                "--output-schema",
                str(schema_path),
                "-o",
                str(out_path),
                full_prompt,
            ],
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
        )

        if result.returncode != 0 or not out_path.exists():
            import sys
            print(f"[cog] codex failed for {summary_path}: rc={result.returncode}", file=sys.stderr)
            if result.stderr:
                print(f"[cog]   stderr: {result.stderr[:500]}", file=sys.stderr)
            return None

        try:
            payload = json.loads(out_path.read_text())
            description = str(payload.get("summary", "")).strip()
        except Exception:
            return None

    if description and summary_has_quality(description):
        summary_path.write_text(description + "\n")
        return description
    return None

archive_dir = pathlib.Path(cog.inFile).parent
subdirs_with_dates = []

for d in archive_dir.iterdir():
    if d.is_dir() and not d.name.startswith('.') and not d.name.startswith('_'):
        try:
            result = subprocess.run(
                ['git', 'log', '--diff-filter=A', '--follow', '--format=%aI', '--reverse', '--', d.name],
                capture_output=True, text=True, timeout=5, cwd=archive_dir
            )
            if result.returncode == 0 and result.stdout.strip():
                date_str = result.stdout.strip().split('\n')[0]
                commit_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                subdirs_with_dates.append((d.name, commit_date))
            else:
                subdirs_with_dates.append((d.name, datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc)))
        except Exception:
            subdirs_with_dates.append((d.name, datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc)))

cog.outl(f"## {len(subdirs_with_dates)} archived projects\n")
subdirs_with_dates.sort(key=lambda x: x[1], reverse=True)

for dirname, commit_date in subdirs_with_dates:
    folder_path = archive_dir / dirname
    readme_path = folder_path / "README.md"
    summary_path = folder_path / "_summary.md"
    date_formatted = commit_date.strftime('%Y-%m-%d')
    github_url = f"{GITHUB_URL}/{dirname}"

    cog.outl(f"### [{dirname}]({github_url}) ({date_formatted})\n")

    if summary_path.exists():
        cog.outl(summary_path.read_text().strip())
    else:
        # Always scan source files for summary
        context = gather_source_context(folder_path)
        if context:
            prompt = (
                "Write 2-3 specific sentences about this project. Include: "
                "(1) what it does, "
                "(2) concrete technologies/frameworks visible in the files, and "
                "(3) one notable capability or architecture detail. "
                "Do not use hedging language (likely/might/appears). No emoji."
            )
            desc = generate_summary(context, prompt, summary_path)
            cog.outl(desc if desc else "*No description available.*")
        else:
            cog.outl("*No description available.*")
    cog.outl()
]]]-->
## 41 archived projects

### [gpt-2-simple-sagemaker-container](https://github.com/shepherdjerred/monorepo/tree/main/archive/gpt-2-simple-sagemaker-container) (2026-02-21)

Containerized toolkit for fine-tuning GPT-2 on Amazon SageMaker, exporting checkpoints back to S3 for endpoint deployment. Uses Docker, Python, Flask, the gpt-2-simple library, and SageMaker’s filesystem conventions wired into `src/sagemaker.py`. It centralizes both training hyperparameter management and inference generation in a single image, exposing a Flask `/invocations` API that streams prompts through `gpt2.generate` on the preloaded TensorFlow session.

### [mira-hq](https://github.com/shepherdjerred/monorepo/tree/main/archive/mira-hq) (2026-02-21)

Mira HQ is a full-stack platform for managing multiplayer servers, exposing GraphQL queries and mutations to list, create, launch, and stop game servers with owner tracking and uptime metadata. The stack combines a Next.js 10 React 17 frontend with Tailwind CSS and Apollo Client, a TypeScript Apollo Server backend on AWS Lambda wired to DynamoDB, and infrastructure defined with AWS CDK/monocdk for CloudFront, S3, API Gateway, and IAM. A shared `@mira-hq/model` package uses graphql-code-generator to produce typed schema, operations, and React hooks that keep client and backend contracts aligned.

### [harding-christmas](https://github.com/shepherdjerred/monorepo/tree/main/archive/harding-christmas) (2026-02-21)

Harding Christmas is a display app for Harding University’s DormNet that counts down in real time to both the annual lighting ceremony and Christmas Day. The project bundles a Bulma-styled Sass frontend with countdown.js and particles.js animations via a Webpack 2 build, serves the bundle through an Express static server, and uses client logic to switch the title and target date from the November 26 lighting event to December 25 once the ceremony time passes.

### [hue-saber](https://github.com/shepherdjerred/monorepo/tree/main/archive/hue-saber) (2026-02-21)

Huesaber synchronizes Philips Hue lights to live Beat Saber events so in-game actions trigger color changes around the player. It is built in Node.js using `ws` for Beat Saber’s HTTP Status websocket feed, `node-hue-api` for bridge control, and `lowdb` with the `FileSync` adapter for local state. The service persists the Hue bridge username in a JSON database so subsequent runs reuse the authenticated session without pressing the bridge button again.

### [monarch-money](https://github.com/shepherdjerred/monorepo/tree/main/archive/monarch-money) (2026-02-21)

This repo bundles command-line tools to import a Monarch Money transaction CSV and explore spending patterns and subscriptions. The scripts are written in TypeScript for the Bun runtime and use `bun:sqlite` against a local SQLite database built by `archive/monarch-money/csv-to-sqlite.ts:1`. Subscription detectors such as `archive/monarch-money/find-subscriptions.ts:7` and `archive/monarch-money/find-yearly-subscriptions.ts:7` run layered SQL CTEs that compute variation coefficients and cadence scores to surface active monthly and yearly recurring charges.

### [rsi-hackathon-2016](https://github.com/shepherdjerred/monorepo/tree/main/archive/rsi-hackathon-2016) (2026-02-21)

This hackathon project delivers a redesigned Rural Sourcing Inc. website packaged as a runnable Java jar that spins up a local web server. It is built with the Java Spark web framework, Thymeleaf templates, Pure.css styling, and custom JavaScript modules for navigation toggles and management popups. The server listens on port 8080, serves static assets from `/assets`, and renders pages like `index`, `company`, and `management` via a shared ThymeleafTemplateEngine.

### [ec2-instance-restart](https://github.com/shepherdjerred/monorepo/tree/main/archive/ec2-instance-restart) (2026-02-21)

This project provides AWS Lambda handlers that start, stop, or list a specific EC2 instance through a shared request processor. It relies on boto3 for EC2 control alongside jsonschema validation and DiscordWebhook notifications to enforce input structure and broadcast operation results. A single `handle_request` workflow in `src/common.py` routes operations defined by the `Operation` enum, giving the Lambda functions a unified orchestration layer.

### [file-matcher](https://github.com/shepherdjerred/monorepo/tree/main/archive/file-matcher) (2026-02-21)

File-matcher is a Python script that scans a directory and cross-references filenames against a provided list of strings to report matches, duplicates, and missing entries. The code runs as a CLI entrypoint in `src/__init__.py` and relies on Python’s standard library modules `os` and `os.path` to enumerate files and read the string list. Its `matcher.match` pipeline collects match statistics and prints comprehensive summaries, including duplicate string detection and files without matches, via reusable helper functions in `src/matcher.py`.

### [siphon](https://github.com/shepherdjerred/monorepo/tree/main/archive/siphon) (2026-02-21)

*No description available.*

### [herd](https://github.com/shepherdjerred/monorepo/tree/main/archive/herd) (2026-02-21)

The project implements a RESTful API for managing clubs and meetings, providing authenticated CRUD endpoints for club membership and meeting scheduling. It is built with Node.js, Express routing, Mongoose models backed by MongoDB, and JWT configuration defined in `api/src/config.js`. Club routes centralize data access by using an `router.param` middleware to preload the club document and populate members before controller handlers run.

### [docblocs](https://github.com/shepherdjerred/monorepo/tree/main/archive/docblocs) (2026-02-21)

Docblocs is a document templating system that parses custom template syntax into an AST and renders it via context-aware helpers to dynamically generate server-side content. The core `@shepherdjerred/docblocs` package in `archive/docblocs/docblocs` is written in TypeScript and ships with tooling such as Mocha, Should, Supertest, and Typedoc, while companion packages like `express-docblocs`, `docblocs-demo`, and `docblocs-test` use Express 4 with Node/Nodemon setups to integrate the renderer into web apps. A notable design detail is the `bindTemplate` pipeline that curries template parameters into local or global scopes and resolves asynchronous helper output before returning the rendered bloc.

### [time-off](https://github.com/shepherdjerred/monorepo/tree/main/archive/time-off) (2026-02-21)

This monorepo consolidates the author's active projects, learning experiments, and archived work into a single workspace documented in `README.md:3`. It runs on Bun-managed TypeScript workspaces with dependencies such as @tauri-apps/api, @dagger.io/dagger, and Lefthook defined in `package.json:1`. The automation script `scripts/run-package-script.ts:1` crawls every package to execute shared scripts with optional skip lists, keeping operations consistent across the repository.

### [kittens](https://github.com/shepherdjerred/monorepo/tree/main/archive/kittens) (2026-02-21)

This project records and visualizes the weight history of several cats, publishing the results through Quarto workflows and Netlify deployments (`archive/kittens/README.md`). It uses a Quarto notebook configured for Jupyter Python 3 with pandas 1.4.3 and plotly 5.9.0 to build dataframes and render interactive line charts (`archive/kittens/kittens.qmd`, `archive/kittens/requirements.txt`). The notebook concatenates per-cat entries, derives pounds and age columns, and then calls `px.line` to generate a single chart that compares all cats in one interactive view (`archive/kittens/kittens.qmd`).

### [gpt-2](https://github.com/shepherdjerred/monorepo/tree/main/archive/gpt-2) (2026-02-21)

This project trains and serves large language models that generate text both interactively and in batch via scripts like `interactive_conditional_samples.py` and `generate_unconditional_samples.py`. It is built on TensorFlow with NumPy for tensor math, Google Fire for CLIs, and Horovod-enabled training in `train-horovod.py` to scale across hardware. A notable capability is its memory-efficient training stack that combines gradient checkpointing in `src/memory_saving_gradients.py` with the accumulation optimizer in `src/accumulate.py` to support oversized models without exhausting GPU memory.

### [west-elm-shipment-notifier](https://github.com/shepherdjerred/monorepo/tree/main/archive/west-elm-shipment-notifier) (2026-02-21)

The project polls the West Elm order-tracking API every hour to detect shipment status changes and send email updates. It is built as an AWS SAM-deployed Python 3.8 Lambda that uses `requests` to call the tracking endpoint and `boto3` to publish notifications. A CloudWatch scheduled event wired with `cron(0 * * * ? *)` triggers the Lambda while a dedicated SNS topic carries both the customer alerts and failure alarms.

### [eng211-research-paper](https://github.com/shepherdjerred/monorepo/tree/main/archive/eng211-research-paper) (2026-02-21)

*No description available.*

### [type-challenges](https://github.com/shepherdjerred/monorepo/tree/main/archive/type-challenges) (2026-02-21)

Project solves the Type Challenges catalog by implementing strongly typed utilities like `DeepReadonly`, `PromiseAll`, and `TupleToUnion` as TypeScript type definitions. It uses pure TypeScript configured by `archive/type-challenges/package.json` and `archive/type-challenges/tsconfig.json`, with the `typescript` dependency driving compile-time checking. All challenge files rely on shared assertion helpers in `archive/type-challenges/test-utils.ts` to validate each type solution at compile time.

### [skill-capped-discord-bot](https://github.com/shepherdjerred/monorepo/tree/main/archive/skill-capped-discord-bot) (2026-02-21)

Skill Capped Discord Bot is a TypeScript-powered Discord automation project that provides commands and services for servers. It leverages Discord.js, AWS CDK (`aws-cdk-lib`), and AWS SDK clients to build and deploy the bot infrastructure defined under `lib/`. A notable capability is the integrated AWS CDK deployment workflow (`cdk synth`, `cdk deploy`) that packages the bot and supporting resources for cloud provisioning.

### [is-quarantine-over-yet](https://github.com/shepherdjerred/monorepo/tree/main/archive/is-quarantine-over-yet) (2026-02-21)

*No description available.*

### [nutrition](https://github.com/shepherdjerred/monorepo/tree/main/archive/nutrition) (2026-02-21)

This project renders a Nutrition Data report that tracks calories, macronutrients, body weight, basal metabolic rate, and exercise calories over time. It runs as a Quarto notebook (`index.qmd`) using Jupyter Python, pandas, and Plotly Express to read CSV exports from MyFitnessPal, Apple Health, and Strava. A notable workflow is the weekly aggregation pipeline that converts day-level logs into weekly averages, then applies the Mifflin-St Jeor equation to estimate TDEE and visualize calorie deficits.

### [jukebox](https://github.com/shepherdjerred/monorepo/tree/main/archive/jukebox) (2026-02-21)

Jukebox is a Rust music controller that maps numeric selections to specific Spotify track IDs and triggers playback routines for connected speakers. It relies on crates such as `rspotify`, `sonos`, `tokio`, `serde`, and `toml` to handle Spotify OAuth, Sonos integration, async execution, and credential parsing. The entrypoint loads credentials from `secrets.toml`, converts them into strongly typed structs, and routes the chosen track through a static device map to keep multi-device playback wiring centralized.

### [hu-easel](https://github.com/shepherdjerred/monorepo/tree/main/archive/hu-easel) (2026-02-21)

The project delivers a TypeScript backend for managing educational entities such as users, courses, and listings backed by a MySQL database. It relies on Node.js modules including `sequelize-typescript` for ORM, `loglevel` for diagnostics, and `ts-jest` for testing. A pluggable configuration layer (EnvConfig, HerokuConfig, SimpleConfig) switches between environment-specific credentials while bootstrapping Sequelize with the full model set.

### [ts-mc](https://github.com/shepherdjerred/monorepo/tree/main/archive/ts-mc) (2026-02-21)

This monorepo consolidates active projects, learning experiments, and archived work into a single workspace with shared tooling and configuration. The root `package.json`, `bun.lock`, and `dagger.json` define a Bun-managed TypeScript stack that layers in Lefthook git hooks, Dagger CI pipelines, and Tauri API dependencies. A notable capability is the `scripts/run-package-script.ts` helper, which walks `packages/*`, honors skip lists, and executes any requested Bun script across every package for consistent orchestration.

### [shepherdjerred-impostor](https://github.com/shepherdjerred/monorepo/tree/main/archive/shepherdjerred-impostor) (2026-02-21)

This archive assembles Impostor server tooling, including the ImpostorCord Discord mute/unmute plugin, a `/settings` chat command extension, and an AWS free-tier CloudFormation stack for hosting the game backend `archive/shepherdjerred-impostor/impostorCord/README.md:5` `archive/shepherdjerred-impostor/commands/README.md:1` `archive/shepherdjerred-impostor/commands/ShepherdJerred/CommandListener.cs:9` `archive/shepherdjerred-impostor/cloudformation-free-tier/README.md:1`. The plugins target .NET 5 with Impostor.Api and DSharpPlus, while the infrastructure relies on CloudFormation YAML and Bash+gomplate templating to scaffold new C# plugin skeletons `archive/shepherdjerred-impostor/impostorCord/README.md:9` `archive/shepherdjerred-impostor/impostorCord/main.cs:1` `archive/shepherdjerred-impostor/impostorCord/README.md:78` `archive/shepherdjerred-impostor/cloudformation-free-tier/template.yml:1` `archive/shepherdjerred-impostor/template/customize:15` `archive/shepherdjerred-impostor/template/[[ .projectName ]].csproj:2`. A notable capability is the event-driven `GameEventListener` that syncs Discord voice permissions with game state while the CloudFormation user data spins up a systemd-managed Docker container with bind mounts so plugins and configs persist across restarts `archive/shepherdjerred-impostor/impostorCord/handlers/EventHandler.cs:20` `archive/shepherdjerred-impostor/cloudformation-free-tier/template.yml:56`.

### [trip-sim](https://github.com/shepherdjerred/monorepo/tree/main/archive/trip-sim) (2026-02-21)

This project models road trip logistics in Python by simulating vehicle, lodging, and food costs for different group sizes and trip lengths. It uses plain Python modules under `api/src/model`, including an AWS Lambda handler in `api/src/aws/handler.py` for serverless execution. The driving simulator evaluates all valid vehicle combinations to pick the lowest total fuel and rental cost configuration for a given group size.

### [push-pal](https://github.com/shepherdjerred/monorepo/tree/main/archive/push-pal) (2026-02-21)

Push Pal provides hosted continuous integration for self-hosted infrastructure, exposing a dashboard to review deployment sites and their stage revisions. The codebase uses a React 18 + TypeScript frontend scaffolded with Vite, integrates Supabase for GitHub OAuth, and publishes documentation through Astro Starlight assets. The UI computes when a main stage revision diverges from prod and conditionally renders a promote action so teams only advance builds when a newer revision exists.

### [instalike](https://github.com/shepherdjerred/monorepo/tree/main/archive/instalike) (2026-02-21)

Instalike is a Node.js automation script that logs into Instagram and likes or comments on every post for a specified target account. It relies on the `instagram-private-api` client along with Bluebird for promise control flow and Underscore utilities, all wired via a simple `node index.js` entry point. The script maintains session cookies on disk and uses a Bluebird `mapSeries` loop to page through the user media feed sequentially, checking prior comments before posting new ones.

### [cashly](https://github.com/shepherdjerred/monorepo/tree/main/archive/cashly) (2026-02-21)

This project provides a monorepo that delivers a React web UI alongside shared core logic and CLI tooling. It uses TypeScript throughout, with React and react-scripts in `web`, and enforces consistency via ESLint configured with @typescript-eslint, Promise, Jest, Import, Node plugins plus Prettier formatting. Its package-level separation (`core`, `web`, `cli`, `mono`, `concept`, `assets`) enables cross-package module reuse under unified linting and formatting rules.

### [ansible-playbook](https://github.com/shepherdjerred/monorepo/tree/main/archive/ansible-playbook) (2026-02-21)

This monorepo collects personal active projects, learning exercises, and archived work under a shared workspace described in `README.md:1`. Its toolchain runs on a Bun-managed TypeScript workspace with Lefthook git hooks, Dagger’s TypeScript SDK, and Tauri APIs declared in `package.json:1`. The automation script `scripts/run-package-script.ts:1` traverses every package subdirectory and executes the requested Bun script while respecting an optional `SKIP_PACKAGES` skip list.

### [usher](https://github.com/shepherdjerred/monorepo/tree/main/archive/usher) (2026-02-21)

Usher is a Create React App frontend that walks Harding students through checking, picking, and releasing chapel seats against the university’s seat assignment system. It runs on React 16 with React Router 4, HashRouter navigation, the node-soap client, react-form, and Bulma styling bundled via react-scripts. The interface centralizes shared Navbar/Wide/Narrow layouts and invokes SOAP operations such as PickSeat through `soap.createClient` to send the chapel seat payload.

### [ec2-instance-restart-frontend](https://github.com/shepherdjerred/monorepo/tree/main/archive/ec2-instance-restart-frontend) (2026-02-21)

EC2 Instance Restart Frontend delivers a React web interface for start/stop control of an EC2 instance through a dedicated restart API endpoint and supporting backend, giving a focused panel for managing that server.citearchive/ec2-instance-restart-frontend/README.md:1archive/ec2-instance-restart-frontend/src/api.ts:5 The project uses React 17 with TypeScript, axios for HTTP calls, Bulma styling, and react-scripts tooling, all declared in its package manifest.citearchive/ec2-instance-restart-frontend/package.json:1 Its Home workflow automatically polls the instance status every second and saves AWS credentials plus instance settings to localStorage so the UI state stays in sync with the backend.citearchive/ec2-instance-restart-frontend/src/components/Home.tsx:28archive/ec2-instance-restart-frontend/src/datastore.ts:3

### [the-button](https://github.com/shepherdjerred/monorepo/tree/main/archive/the-button) (2026-02-21)

This React Native mobile app connects to https://the-button-api.herokuapp.com/ to show a shared countdown and let users press a styled button while tracking connected peers in real time. It is built with React Native components, socket.io-client for the live socket connection, and react-test-renderer-backed tests living under app/__tests__. The App component maintains socket-driven state updates and delegates UI responsibilities to focused child components like app-button, app-progress, and app-users for clearer separation of concerns.

### [lambda-sagemaker-endpoint](https://github.com/shepherdjerred/monorepo/tree/main/archive/lambda-sagemaker-endpoint) (2026-02-21)

This project runs AWS Lambda functions that bridge a Telegram chatbot to an Amazon SageMaker inference endpoint. It uses boto3’s `runtime.sagemaker` client, the python-telegram-bot library, and AWS SAM templates (`template.yml`) to wire the deployment. The architecture routes Telegram webhook events through a Lambda handler that calls a dedicated SageMaker-invoking Lambda, enabling conversational responses powered by the model endpoint.

### [easely](https://github.com/shepherdjerred/monorepo/tree/main/archive/easely) (2026-02-21)

This project delivers an Easely API service that exposes assignment, course, and user endpoints via Spark Java routing. It is implemented in Java with Spark, Jackson, HikariCP, Redisson, MySQL storage components, and Log4j2 logging. The core data flow layers a Redisson-backed cache and cached scraper on top of configurable data sources, initialized through environment-driven `EaselyConfig` and `EnvVarEaselyConfig` components.

### [raspastat](https://github.com/shepherdjerred/monorepo/tree/main/archive/raspastat) (2026-02-21)

This project runs a RaspaStat web service that serves a dashboard and REST endpoints for reading and updating thermostat status data. It is built with Spark Java routing, Thymeleaf templating, Log4j2 logging, Apache Commons Lang, and Redis access via Jedis. The router centralizes route setup while a shared JedisPool wrapper provides Redis-backed state for the API handlers.

### [list-easel](https://github.com/shepherdjerred/monorepo/tree/main/archive/list-easel) (2026-02-21)

This Node.js utility enumerates Harding University EASEL classes by programmatically crawling class identifiers. It runs with dotenv-driven configuration and leverages request-promise-native, tough-cookie, jsdom, and loglevel to handle authenticated HTTP requests and HTML parsing. It maintains a reusable cookie jar and halts the scan after detecting multiple nonexistent classes to avoid unnecessary traffic.

### [aws-docker-cdk](https://github.com/shepherdjerred/monorepo/tree/main/archive/aws-docker-cdk) (2026-02-21)

AWS Docker CDK provisions dedicated Minecraft and Factorio Docker game servers on AWS with configurable versions, memory, and routing settings defined in its primary stack (`archive/aws-docker-cdk/lib/aws-docker-cdk-stack.ts:1`). The project uses TypeScript with the `monocdk` AWS CDK distribution plus `aws-dlm`, coordinated by Node-based scripts such as `npm run cdk` and dependencies like `ts-node` and `typescript` (`archive/aws-docker-cdk/lib/aws-docker-cdk-stack.ts:1`, `archive/aws-docker-cdk/package.json:1`). A continuous delivery stack supplies an IAM deployment user and managed policy while the main stack automates EBS snapshot lifecycle management via AWS Data Lifecycle Manager, embedding operational guardrails into the architecture (`archive/aws-docker-cdk/lib/continuous-delivery-stack.ts:1`, `archive/aws-docker-cdk/lib/aws-docker-cdk-stack.ts:37`).

### [funsheet](https://github.com/shepherdjerred/monorepo/tree/main/archive/funsheet) (2026-02-21)

Funsheet is a Java-backed web application that lets users catalog activities and search them by location, cost, types, and tags. It runs a Spark Framework REST API with HikariCP, FluentJDBC, Flyway, Jackson, Lombok, and a Vue front end using Vuex, Vue Router, Buefy, Vue Resource, and Fuse. The server supports swappable persistence via a MySQL-backed `MysqlStore` and an `InMemoryStore` seeded through `setupInMemoryStorage` and `createMockData` for development flexibility.

### [devcontainers-features](https://github.com/shepherdjerred/monorepo/tree/main/archive/devcontainers-features) (2026-02-21)

*No description available.*

### [frankie-and-jos-flavor-scraper](https://github.com/shepherdjerred/monorepo/tree/main/archive/frankie-and-jos-flavor-scraper) (2026-02-21)

This Python scraper gathers Frankie and Jo’s flavor articles by crawling the site’s news listings and retrieving article text. It uses `requests`, `re`, and `BeautifulSoup` in `src/main.py` to fetch pages and parse the flavor content. The crawler iterates through ten news pages set by `LAST_NEWS_PAGE` to collect flavor URLs with a regex before extracting the article body.

### [discord](https://github.com/shepherdjerred/monorepo/tree/main/archive/discord) (2026-02-21)

This monorepo hosts Discord automation projects for a private server, including bots for karma, League of Legends match tracking with reports and leaderboards, music playback, and companion documentation sites. It runs on a Bun-managed TypeScript workspace with tooling like Dagger pipelines and Lefthook hooks declared in the root `package.json`. The repository is organized as a multi-package workspace under `packages/`, enabling shared builds and scripts across the various bots and front-end portals.

<!--[[[end]]]-->
