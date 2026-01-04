# Archive

Archived personal projects - completed, abandoned, or superseded.

<!--[[[cog
import cog
import subprocess
import pathlib
import json
from datetime import datetime, timezone

MODEL = "gpt-4.1"
GITHUB_URL = "https://github.com/shepherdjerred/monorepo/tree/main/archive"

def gather_source_context(folder_path, max_chars=8000):
    """Gather context from source files when no README exists."""
    context_parts = []

    # Check package.json
    pkg_json = folder_path / "package.json"
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text())
            context_parts.append(f"package.json: name={pkg.get('name')}, description={pkg.get('description')}, dependencies={list(pkg.get('dependencies', {}).keys())[:10]}")
        except: pass

    # Check Cargo.toml
    cargo_toml = folder_path / "Cargo.toml"
    if cargo_toml.exists():
        context_parts.append(f"Cargo.toml:\n{cargo_toml.read_text()[:1000]}")

    # Check pyproject.toml
    pyproject = folder_path / "pyproject.toml"
    if pyproject.exists():
        context_parts.append(f"pyproject.toml:\n{pyproject.read_text()[:1000]}")

    # Find main source files
    main_files = [
        "src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx",
        "index.ts", "index.tsx", "main.ts", "main.tsx",
        "src/main.rs", "src/lib.rs", "main.rs", "lib.rs",
        "src/index.js", "index.js", "main.js",
        "src/main.py", "main.py", "app.py", "__init__.py",
    ]

    for mf in main_files:
        fp = folder_path / mf
        if fp.exists():
            content = fp.read_text()[:2000]
            context_parts.append(f"{mf}:\n{content}")
            break

    # List directory structure
    try:
        files = [f.name for f in folder_path.iterdir() if not f.name.startswith('.')][:20]
        context_parts.append(f"Files: {', '.join(files)}")
    except: pass

    return "\n\n".join(context_parts)[:max_chars]

def generate_summary(content, prompt, summary_path):
    """Generate summary using LLM and cache it."""
    result = subprocess.run(
        ['uvx', '--from', 'llm', 'llm', '-m', MODEL, '-s', prompt],
        input=content, capture_output=True, text=True, timeout=120
    )
    if result.returncode == 0 and result.stdout.strip():
        description = result.stdout.strip()
        summary_path.write_text(description + '\n')
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
            prompt = "Based on these source files, summarize this project in 2-3 sentences. Be specific about technologies used. No emoji."
            desc = generate_summary(context, prompt, summary_path)
            cog.outl(desc if desc else "*No description available.*")
        else:
            cog.outl("*No description available.*")
    cog.outl()
]]]-->
## 41 archived projects

### [kittens](https://github.com/shepherdjerred/monorepo/tree/main/archive/kittens) (2025-12-23)

This project is a Quarto-based documentation or report about kittens, as indicated by the primary content file kittens.qmd. It uses Python dependencies specified in requirements.txt and includes configuration for automated publishing through GitHub Actions (_publish.yml). The project also contains images (img folder) and a README.md for explanation, and it is distributed under the MIT License.

### [list-easel](https://github.com/shepherdjerred/monorepo/tree/main/archive/list-easel) (2025-12-23)

This project, "list-easel," is a Node.js-based tool that utilizes libraries such as dotenv for environment variable management, jsdom for parsing HTML in a server environment, loglevel for logging, and request/request-promise-native for making HTTP requests with tough-cookie for handling cookies. The source code resides in the "src" directory, and the package is configured for dependency management and reproducible builds via npm. The combination of these technologies suggests the project is designed for web scraping or programmatically interacting with web content in a structured and logged manner.

### [devcontainers-features](https://github.com/shepherdjerred/monorepo/tree/main/archive/devcontainers-features) (2025-12-23)

This project is a TypeScript application, as indicated by the presence of a `src` directory and related test files, structured for robust development and testing. It utilizes Earthly for containerized builds, as specified by the `Earthfile`, enabling streamlined and reproducible CI/CD workflows. The project is open-source, as indicated by the LICENSE file, and the included README.md provides usage and setup instructions.

### [the-button](https://github.com/shepherdjerred/monorepo/tree/main/archive/the-button) (2025-12-23)

This project is a full-stack application consisting of three components: **app**, **web**, and **api**. The **app** directory likely contains a mobile client, possibly built with React Native or Flutter; the **web** directory contains a web frontend, probably built with React, Vue, or another JavaScript framework; and the **api** directory implements a backend—likely using Node.js/Express, Python/Django, or a similar server framework—which serves data and handles authentication for both clients. Together, these components provide a responsive and scalable application architecture supporting both web and mobile platforms.

### [monarch-money](https://github.com/shepherdjerred/monorepo/tree/main/archive/monarch-money) (2025-12-23)

This project is a TypeScript-based toolset for analyzing and extracting subscription data from structured sources. It includes scripts to convert CSV files into a SQLite database, and to identify recurring and yearly subscriptions within the data. The solution leverages Node.js, the sqlite3 package, and efficient text and date processing to automate the analysis and reporting of subscription transactions.

### [gpt-2-simple-sagemaker-container](https://github.com/shepherdjerred/monorepo/tree/main/archive/gpt-2-simple-sagemaker-container) (2025-12-23)

This project is a machine learning application built with Python, as outlined in the requirements.txt, and containerized using Docker via the provided Dockerfile. The application includes scripts and source code for both training ("train") and serving ("serve") models, with commands for building and pushing Docker images for deployment. The structure and configuration indicate usage for scalable and reproducible ML model deployment.

### [discord](https://github.com/shepherdjerred/monorepo/tree/main/archive/discord) (2025-12-23)

This project is a monorepo managed within a Visual Studio Code workspace, as indicated by the presence of the `glitter.code-workspace` file and the `packages` directory. It uses Earthly (`Earthfile`) for build automation and Jenkins (`Jenkinsfile`) for CI/CD workflows, supporting efficient development and deployment. The repository includes documentation (`README.md`, `ROADMAP.md`), licensing information, and asset management, suggesting a structured approach to both code and project management.

### [docblocs](https://github.com/shepherdjerred/monorepo/tree/main/archive/docblocs) (2025-12-23)

This project is a documentation generation toolkit designed for Node.js and Express.js applications. It leverages custom files and modules (such as `docblocs`, `docblocs-demo`, `docblocs-test`, and `express-docblocs`) to parse and generate API documentation directly from annotated source code. Built with JavaScript, it integrates easily with Express.js servers to provide live or static documentation for RESTful APIs.

### [ansible-playbook](https://github.com/shepherdjerred/monorepo/tree/main/archive/ansible-playbook) (2025-12-23)

This project is an infrastructure automation setup using Ansible, as indicated by the presence of ansible.cfg, various YAML playbooks (e.g., zeus.yml, hades.yml, dionysus.yml, main.yml), and supporting inventory files (inventory.yml, servers.yml). It leverages Ansible roles, group and host variable directories, and a requirements.yml for managing role dependencies, with secure vault handling via vault_password_file. The project is organized to manage and configure server environments following best practices for Ansible-based orchestration.

### [file-matcher](https://github.com/shepherdjerred/monorepo/tree/main/archive/file-matcher) (2025-12-23)

This project is a Python-based application organized under the src directory, with dependencies managed via requirements.txt. It leverages popular Python libraries as specified in the requirements file and includes documentation in the README.md, while the LICENSE file indicates it is open source. The structure suggests a modular design, suitable for development and distribution in a modern Python environment.

### [west-elm-shipment-notifier](https://github.com/shepherdjerred/monorepo/tree/main/archive/west-elm-shipment-notifier) (2025-12-23)

This project is an AWS Lambda application written in Python, structured using the AWS SAM (Serverless Application Model) framework. It leverages AWS services for serverless deployment, and the configuration files provided (template.yml, samconfig.toml) define the Lambda resources, API Gateway setup, and deployment parameters. The code resides in the src directory, enabling streamlined packaging and deployment of serverless functions.

### [push-pal](https://github.com/shepherdjerred/monorepo/tree/main/archive/push-pal) (2025-12-23)

This project appears to be a monorepo managed in a workspace structure (as indicated by the presence of the `packages` directory and `push-pal.code-workspace` file), utilizing the Earthly build system (Earthfile) for automation and Docker-compatible builds. Dependency management and updates are automated with Renovate, as configured in `renovate.json`. The overall aim and technical approach, with supporting documentation in README and ROADMAP files, suggest a modern, modular development workflow leveraging containerization and automated CI/CD practices.

### [time-off](https://github.com/shepherdjerred/monorepo/tree/main/archive/time-off) (2025-12-23)

This project is a Jupyter Notebook implementing a time off management system, as outlined in the README.md. It is built in Python and demonstrates workflows for employees to request and track time off, likely leveraging popular Python libraries for data handling and user interaction within the notebook environment. The project is distributed under an open-source license as specified in the LICENSE file.

### [herd](https://github.com/shepherdjerred/monorepo/tree/main/archive/herd) (2025-12-23)

This project is a web application that uses a combination of frontend, backend, and scripting technologies. The "web" directory likely contains the frontend code (possibly using HTML, CSS, and JavaScript frameworks), while the "api" folder implements backend functionality, potentially with Node.js or Python for handling HTTP requests. The "scripts" directory stores utility or automation scripts, and "assets" holds static resources such as images or stylesheets.

### [usher](https://github.com/shepherdjerred/monorepo/tree/main/archive/usher) (2025-12-23)

This project, named "usher," is a web application built with React and styled using Bulma CSS framework. It utilizes libraries such as react-router (for routing), react-form (for form management), and react-json-pretty (for pretty-printing JSON). Additionally, it includes the "soap" package for SOAP web service interactions and sets up a service worker for potential offline support.

### [is-quarantine-over-yet](https://github.com/shepherdjerred/monorepo/tree/main/archive/is-quarantine-over-yet) (2025-12-23)

This project is a software application developed using JavaScript, as indicated by the structure of the `src` directory. According to the README.md, it utilizes modern web technologies such as React for building the user interface and may incorporate other tools or libraries as dependencies. The codebase is open source and governed by the terms specified in the included license file.

### [ts-mc](https://github.com/shepherdjerred/monorepo/tree/main/archive/ts-mc) (2025-12-23)

This project implements a forums application, as indicated by the "forums" directory, using infrastructure configurations found in the "infrastructure" directory. The project likely includes backend and/or frontend code to provide discussion forum features, and uses Infrastructure as Code (IaC) technology—such as Terraform, AWS CloudFormation, or Docker Compose—to automate the provisioning and management of related resources. The technology stack likely includes common forum frameworks or libraries and modern infrastructure automation tools.

### [frankie-and-jos-flavor-scraper](https://github.com/shepherdjerred/monorepo/tree/main/archive/frankie-and-jos-flavor-scraper) (2025-12-23)

This project is a Python web scraper that uses requests, BeautifulSoup, and regular expressions to extract ice cream flavor information from the Frankie & Jo's website blog/news section. It crawls multiple news pages, locates URLs related to flavor announcements, and parses visible text content for further processing. The code is organized for modular crawling and extraction of flavor names and descriptions.

### [skill-capped-discord-bot](https://github.com/shepherdjerred/monorepo/tree/main/archive/skill-capped-discord-bot) (2025-12-23)

This project is a Discord bot named "skill-capped-discord-bot" developed with Node.js and TypeScript, using the discord.js library for interacting with the Discord API. It leverages AWS services via the AWS SDK and AWS CDK for cloud resource management, and includes support for S3 storage. Additional libraries like axios are used for HTTP requests, and the project is containerized using Docker for deployment.

### [eng211-research-paper](https://github.com/shepherdjerred/monorepo/tree/main/archive/eng211-research-paper) (2025-12-23)

This project centers on the development and documentation of a scholarly paper using LaTeX, as evidenced by the use of .tex files (paper.tex, outline.tex) and a BibTeX bibliography file (bibliography.bib) for managing references. Complementary materials, such as a project proposal and an annotated bibliography provided as .docx documents, suggest a comprehensive academic workflow that leverages both LaTeX/BibTeX for technical writing and Microsoft Word for preliminary planning and resource annotation. The overall approach highlights an integration of typesetting technologies for academic research and writing.

### [type-challenges](https://github.com/shepherdjerred/monorepo/tree/main/archive/type-challenges) (2025-12-23)

This project is a collection of TypeScript utility type challenges, each implemented in its own TypeScript file. It leverages advanced TypeScript features such as conditional types, mapped types, inference, and template literal types to solve a variety of problems (e.g., manipulating tuples, strings, and object types). The project is purely TypeScript-based, as indicated by the package dependency and the file contents.

### [shepherdjerred-impostor](https://github.com/shepherdjerred/monorepo/tree/main/archive/shepherdjerred-impostor) (2025-12-23)

This project provides a set of source files for setting up and managing AWS infrastructure using a CloudFormation template, along with code for a Discord bot named ImpostorCord. The bot includes command handling logic, likely enabling users to interact with and control AWS cloud resources through Discord. The technologies used in the project include AWS CloudFormation for infrastructure-as-code and Discord.js (Node.js) for building and managing the Discord bot commands.

### [ec2-instance-restart-frontend](https://github.com/shepherdjerred/monorepo/tree/main/archive/ec2-instance-restart-frontend) (2025-12-23)

This project is a React-based frontend application, styled with Bulma, designed to interact with AWS EC2 instance restart functionality. It uses TypeScript, Axios for HTTP requests, and is structured using modern React best practices. The deployment is managed with AWS SAM (as indicated by the template.yml file), making it suitable for serverless environments.

### [mira-hq](https://github.com/shepherdjerred/monorepo/tree/main/archive/mira-hq) (2025-12-23)

This project is a full-stack web application with a modular architecture comprising frontend, backend, model, and infrastructure components. The frontend is likely built using a modern JavaScript framework, while the backend handles API requests, business logic, and integrates with a separate model layer, possibly involving machine learning or data processing. The infrastructure directory contains configuration and deployment scripts, enabling scalable and efficient deployment of the application.

### [hue-saber](https://github.com/shepherdjerred/monorepo/tree/main/archive/hue-saber) (2025-12-23)

This project, "ideaprojects," is a Node.js application that leverages the node-hue-api library to control Philips Hue lights in response to Beat Saber game events received via WebSocket (ws). It uses dotenv for environment variable management and lowdb for storing configuration (such as Hue API credentials). The application auto-discovers Hue bridges, manages user authentication, and sets light states based on real-time Beat Saber data.

### [jukebox](https://github.com/shepherdjerred/monorepo/tree/main/archive/jukebox) (2025-12-23)

This project, "jukebox," is a Rust application designed to control music playback on Sonos devices and Spotify. It uses the sonos crate for Sonos device discovery and control, and the rspotify crate (with CLI support) for interfacing with the Spotify Web API, handling authorization via credentials read from a local TOML file. The code is asynchronous, leveraging Tokio for async runtime, and configurations/credentials are handled using Serde and toml parsing.

### [funsheet](https://github.com/shepherdjerred/monorepo/tree/main/archive/funsheet) (2025-12-23)

This project is a Java-based web application built using the Spring Boot framework, as specified in the `pom.xml`, with dependencies managed via Maven. It includes a `Procfile` for deployment on Heroku, indicating it is intended for cloud deployment. The codebase, located in the `src` directory, adheres to the Apache License 2.0 as described in the LICENSE file.

### [rsi-hackathon-2016](https://github.com/shepherdjerred/monorepo/tree/main/archive/rsi-hackathon-2016) (2025-12-23)

This project is a Java-based application managed with Maven, as indicated by the presence of a pom.xml file. The source code resides in the "src" directory, and the project likely uses dependencies and plugins specified in the pom.xml for building and managing the application lifecycle. Detailed usage, setup instructions, and further documentation can be found in the README.md file.

### [gpt-2](https://github.com/shepherdjerred/monorepo/tree/main/archive/gpt-2) (2025-12-23)

This project provides tools and scripts for training, encoding, and managing a language model, leveraging technologies such as PyTorch, Hugging Face Transformers, and optionally distributed training with Horovod. It includes Docker support for containerized deployment, shell scripts for data preparation, and Python entrypoints for model training and inference. The codebase is modular, with core logic organized within the "src" directory, and is designed for extensibility and collaborative development.

### [lambda-sagemaker-endpoint](https://github.com/shepherdjerred/monorepo/tree/main/archive/lambda-sagemaker-endpoint) (2025-12-23)

This project is a serverless application built using AWS SAM (Serverless Application Model), as indicated by the presence of template.yml and samconfig.toml. The application's source code resides in the src directory. The build_and_deploy script automates building and deploying the app to AWS, leveraging tools such as AWS Lambda and possibly other AWS services, as defined in the SAM template.

### [hu-easel](https://github.com/shepherdjerred/monorepo/tree/main/archive/hu-easel) (2025-12-23)

This project appears to be a web application structured with three main components: a frontend in the "web" directory, backend logic in the "api" directory, and supporting automation or build tools in "scripts." The frontend likely utilizes modern web technologies (such as HTML, CSS, JavaScript, or a framework like React or Vue), while the API directory suggests a server-side backend, possibly using Node.js, Python, or another language/framework for handling requests and backend logic. The scripts directory contains utilities for tasks like deployment, setup, or testing automation.

### [harding-christmas](https://github.com/shepherdjerred/monorepo/tree/main/archive/harding-christmas) (2025-12-23)

This project, "harding-christmas," is a Node.js web application that provides a countdown to Christmas for Harding University. It uses Express as the web server and incorporates Bulma for styling, as well as several Webpack loaders and plugins for asset handling and build optimization. Frontend functionality relies on the "countdown" library, and the build process leverages tools such as css-loader, file-loader, and cssnano for CSS and file management.

### [aws-docker-cdk](https://github.com/shepherdjerred/monorepo/tree/main/archive/aws-docker-cdk) (2025-12-23)

This project, "aws-docker-cdk," is an AWS infrastructure setup tool using the AWS Cloud Development Kit (CDK) with TypeScript. It leverages dependencies such as aws-cdk, monocdk, and constructs to define cloud resources, potentially including Dockerized workloads given the project name. The configuration supports TypeScript development and deployment, utilizing tools like ts-node and source-map-support.

### [raspastat](https://github.com/shepherdjerred/monorepo/tree/main/archive/raspastat) (2025-12-23)

This project consists of a core backend module and a web frontend module. The backend (core) is likely implemented in a language such as Python, Java, or Node.js, handling business logic, data processing, and possibly API management. The frontend (web) provides a user interface, most likely built with web technologies such as HTML, CSS, and JavaScript, which interacts with the backend to deliver a complete application experience.

### [nutrition](https://github.com/shepherdjerred/monorepo/tree/main/archive/nutrition) (2025-12-23)

This project is a data analysis tool that parses Apple Health data using a Python script (`apple-health-data-parser.py`). It is built with Quarto for creating interactive reports (`index.qmd`) and uses a Python virtual environment managed by Pipenv (`Pipfile`, `Pipfile.lock`). The configuration files (`_quarto.yml`, `_publish.yml`) control the Quarto rendering and publication process, allowing the results to be published as a website or report.

### [trip-sim](https://github.com/shepherdjerred/monorepo/tree/main/archive/trip-sim) (2025-12-23)

This project consists of two main components: a web frontend and an API backend. The **web** directory likely contains a frontend application built with a modern JavaScript framework (such as React, Vue, or Angular), enabling user interaction through a browser interface. The **api** directory contains a backend service, possibly implemented with technologies like Node.js/Express, Python/Flask, or another framework, providing data and business logic to the frontend via RESTful endpoints.

### [instalike](https://github.com/shepherdjerred/monorepo/tree/main/archive/instalike) (2025-12-23)

This project, Instalike, is a Node.js automation tool that uses the instagram-private-api, bluebird (for Promises), and underscore libraries to interact with Instagram programmatically. It logs into Instagram, retrieves recent posts from a target account, and comments on posts that the user hasn't yet commented on, choosing a random comment from a preset list. The project structures authentication using cookie storage for session persistence.

### [ec2-instance-restart](https://github.com/shepherdjerred/monorepo/tree/main/archive/ec2-instance-restart) (2025-12-23)

This project is an AWS Lambda application written in Python, orchestrated using AWS SAM as defined in the template.yml file. It leverages AWS services such as Lambda and API Gateway, and the source code resides in the src directory. The setup and deployment instructions, as well as usage information, are detailed in the README.md.

### [easely](https://github.com/shepherdjerred/monorepo/tree/main/archive/easely) (2025-12-23)

This project is a web-based application featuring a front end in the "web" directory, backend logic and endpoints in "api", and supporting code in "scripts". It uses web technologies (likely HTML, CSS, JavaScript) for the interface, while backend API services (possibly Node.js or Python with RESTful routes) handle data and business logic. Script files support automation or build tasks, tying together front end and back end components.

### [cashly](https://github.com/shepherdjerred/monorepo/tree/main/archive/cashly) (2025-12-23)

This project is a modular application structured with core logic in the `core` module, a CLI in the `cli` module, and a web interface in the `web` module. It leverages a monorepo architecture (`mono`), likely using shared concepts and assets across different components. Technologies suggested by the structure include a command-line tool, a web application (possibly with frameworks like React, Express, or similar), and core logic that is decoupled and reusable across interfaces.

### [siphon](https://github.com/shepherdjerred/monorepo/tree/main/archive/siphon) (2025-12-23)

This project, "siphon-vue," is a Vue.js-based client application designed for the "siphon-web" platform. It uses a Node.js and Express server (as seen in index.js) to serve static frontend assets built into the "dist" directory. The development setup incorporates Babel for JavaScript transpilation and modern JavaScript features, as well as front-end tooling such as autoprefixer for CSS and autotrack for analytics.

<!--[[[end]]]-->
