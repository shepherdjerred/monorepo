# Providers & Security Reference

## Provider Configuration

### Provider Requirements

```hcl
terraform {
  required_version = ">= 1.8"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}
```

### Version Constraints

```hcl
version = "5.0.0"     # Exact version
version = "~> 5.0"    # >= 5.0.0 and < 6.0.0
version = "~> 5.0.1"  # >= 5.0.1 and < 5.1.0
version = ">= 5.0"    # Any version >= 5.0.0
version = ">= 5.0, < 6.0"  # Range
```

For reusable modules, use minimum version constraints (`>= 5.0`). For root modules, use pessimistic constraints (`~> 5.0`).

### Provider Aliases

```hcl
# Default provider
provider "aws" {
  region = "us-east-1"
}

# Aliased provider for another region
provider "aws" {
  alias  = "west"
  region = "us-west-2"
}

# Use aliased provider
resource "aws_instance" "west_server" {
  provider      = aws.west
  ami           = "ami-abc123"
  instance_type = "t3.micro"
}

# Pass provider to module
module "west_vpc" {
  source = "./modules/vpc"

  providers = {
    aws = aws.west
  }
}
```

### OpenTofu Provider for_each (1.9+)

```hcl
variable "regions" {
  type    = map(string)
  default = {
    east = "us-east-1"
    west = "us-west-2"
  }
}

provider "aws" {
  alias    = "by_region"
  for_each = var.regions
  region   = each.value
}

resource "aws_vpc" "regional" {
  for_each   = var.regions
  provider   = aws.by_region[each.key]
  cidr_block = "10.${index(keys(var.regions), each.key)}.0.0/16"
}
```

## Popular Providers

### AWS Provider

```hcl
provider "aws" {
  region = "us-east-1"

  # Default tags for all resources
  default_tags {
    tags = {
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }

  # Assume role
  assume_role {
    role_arn     = "arn:aws:iam::123456789012:role/TerraformRole"
    session_name = "terraform"
  }

  # Ignore specific tags
  ignore_tags {
    key_prefixes = ["kubernetes.io/"]
  }
}
```

Common AWS resources:
- `aws_vpc`, `aws_subnet`, `aws_security_group`, `aws_internet_gateway`
- `aws_instance`, `aws_launch_template`, `aws_autoscaling_group`
- `aws_s3_bucket`, `aws_s3_object`, `aws_s3_bucket_policy`
- `aws_db_instance`, `aws_rds_cluster`, `aws_elasticache_cluster`
- `aws_lambda_function`, `aws_api_gateway_rest_api`
- `aws_ecs_cluster`, `aws_ecs_service`, `aws_ecs_task_definition`
- `aws_eks_cluster`, `aws_eks_node_group`
- `aws_iam_role`, `aws_iam_policy`, `aws_iam_role_policy_attachment`
- `aws_route53_zone`, `aws_route53_record`
- `aws_cloudfront_distribution`, `aws_acm_certificate`
- `aws_sqs_queue`, `aws_sns_topic`, `aws_kinesis_stream`

### Google Cloud Provider

```hcl
provider "google" {
  project = "my-project"
  region  = "us-central1"
}

# With impersonation
provider "google" {
  impersonate_service_account = "terraform@my-project.iam.gserviceaccount.com"
}
```

Common GCP resources:
- `google_compute_network`, `google_compute_subnetwork`, `google_compute_firewall`
- `google_compute_instance`, `google_compute_instance_template`
- `google_storage_bucket`, `google_storage_bucket_object`
- `google_sql_database_instance`, `google_sql_database`
- `google_container_cluster`, `google_container_node_pool`
- `google_cloudfunctions2_function`, `google_cloud_run_v2_service`
- `google_project_iam_member`, `google_service_account`

### Azure Provider

```hcl
provider "azurerm" {
  features {}

  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id
}
```

Common Azure resources:
- `azurerm_resource_group`, `azurerm_virtual_network`, `azurerm_subnet`
- `azurerm_linux_virtual_machine`, `azurerm_windows_virtual_machine`
- `azurerm_storage_account`, `azurerm_storage_container`
- `azurerm_mssql_server`, `azurerm_cosmosdb_account`
- `azurerm_kubernetes_cluster`
- `azurerm_linux_function_app`, `azurerm_service_plan`
- `azurerm_key_vault`, `azurerm_key_vault_secret`

### Kubernetes Provider

```hcl
provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "my-cluster"
}

# From EKS
provider "kubernetes" {
  host                   = data.aws_eks_cluster.cluster.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.cluster.token
}
```

## Security Scanning

### tflint

tflint catches provider-specific mistakes, deprecated syntax, unused declarations, and naming conventions.

```bash
# Install
brew install tflint

# Initialize (download plugins)
tflint --init

# Run linter
tflint

# Run recursively
tflint --recursive

# Output formats: default, json, checkstyle, junit, sarif
tflint --format json
```

Configuration `.tflint.hcl`:

```hcl
config {
  # Module inspection (requires terraform init)
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.31.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

plugin "google" {
  enabled = true
  version = "0.28.0"
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}

plugin "azurerm" {
  enabled = true
  version = "0.26.0"
  source  = "github.com/terraform-linters/tflint-ruleset-azurerm"
}

# Custom rule configuration
rule "terraform_naming_convention" {
  enabled = true
  format  = "snake_case"
}

rule "terraform_documented_variables" {
  enabled = true
}

rule "terraform_documented_outputs" {
  enabled = true
}

rule "terraform_unused_declarations" {
  enabled = true
}

rule "terraform_typed_variables" {
  enabled = true
}
```

### Trivy (successor to tfsec)

Trivy scans Terraform configurations for security misconfigurations.

```bash
# Install
brew install trivy

# Scan Terraform directory
trivy config .

# Filter by severity
trivy config --severity HIGH,CRITICAL .

# Output as JSON
trivy config --format json --output results.json .

# Skip specific checks
trivy config --skip-dirs .terraform --skip-check AVD-AWS-0107 .

# Scan with custom policy
trivy config --policy ./policies .

# Scan specific file
trivy config main.tf
```

Common findings and fixes:

```hcl
# FINDING: S3 bucket without encryption
# FIX:
resource "aws_s3_bucket_server_side_encryption_configuration" "example" {
  bucket = aws_s3_bucket.example.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

# FINDING: Security group with unrestricted ingress
# FIX:
resource "aws_security_group_rule" "ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["10.0.0.0/8"]  # Restrict to internal network
  security_group_id = aws_security_group.main.id
}

# FINDING: RDS without encryption at rest
# FIX:
resource "aws_db_instance" "main" {
  storage_encrypted = true
  kms_key_id        = aws_kms_key.rds.arn
  # ...
}
```

### Infracost

```bash
# Install
brew install infracost

# Authenticate
infracost auth login

# Cost breakdown for current directory
infracost breakdown --path .

# Cost diff between changes
infracost diff --path . --compare-to infracost-base.json

# Output formats: table (default), json, html, diff, github-comment, slack-message
infracost breakdown --path . --format json --out-file infracost.json
```

CI/CD integration:

```yaml
# GitHub Actions example
- name: Generate Infracost diff
  run: |
    infracost breakdown --path . --format json --out-file /tmp/infracost.json
    infracost comment github \
      --path /tmp/infracost.json \
      --repo ${{ github.repository }} \
      --pull-request ${{ github.event.pull_request.number }} \
      --github-token ${{ secrets.GITHUB_TOKEN }}
```

## Policy as Code

### Sentinel (HCP Terraform / Terraform Enterprise)

```python
# policy.sentinel
import "tfplan/v2" as tfplan

# Require all EC2 instances to have tags
main = rule {
  all tfplan.resource_changes as _, rc {
    rc.type is "aws_instance" and
    rc.change.after.tags is not null and
    rc.change.after.tags contains "Environment"
  }
}
```

### Open Policy Agent (OPA)

```rego
# policy.rego
package terraform

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_security_group_rule"
  resource.change.after.cidr_blocks[_] == "0.0.0.0/0"
  resource.change.after.from_port == 22
  msg := "SSH access must not be open to the internet"
}

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket"
  not resource.change.after.tags.Environment
  msg := "S3 buckets must have an Environment tag"
}
```

```bash
# Evaluate with OPA
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
opa eval --input tfplan.json --data policy.rego "data.terraform.deny"
```

## CI/CD Patterns

### GitHub Actions Workflow

```yaml
name: Terraform

on:
  pull_request:
    paths: ['**.tf', '**.tfvars']
  push:
    branches: [main]

jobs:
  terraform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.10.x"

      - name: Terraform Init
        run: terraform init

      - name: Terraform Format Check
        run: terraform fmt -check -recursive

      - name: Terraform Validate
        run: terraform validate

      - name: tflint
        run: |
          tflint --init
          tflint --recursive

      - name: Trivy Security Scan
        run: trivy config --severity HIGH,CRITICAL --exit-code 1 .

      - name: Terraform Plan
        if: github.event_name == 'pull_request'
        run: terraform plan -no-color -out=tfplan

      - name: Terraform Apply
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: terraform apply -auto-approve tfplan
```

### Pre-commit Hooks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.86.0
    hooks:
      - id: terraform_fmt
      - id: terraform_validate
      - id: terraform_tflint
        args: ['--args=--recursive']
      - id: terraform_trivy
      - id: terraform_docs
        args: ['--args=--config=.terraform-docs.yml']
```

## OpenTofu-Specific Features

### Early Evaluation (1.8+)

Use variables in backend and module sources:

```hcl
variable "environment" {
  type = string
}

variable "state_bucket" {
  type = string
}

terraform {
  backend "s3" {
    bucket = var.state_bucket
    key    = "${var.environment}/terraform.tfstate"
    region = "us-east-1"
  }
}

module "vpc" {
  source  = "git::https://github.com/org/modules.git//vpc?ref=${var.module_version}"
  # ...
}
```

### Provider Mocking in Tests (1.8+)

```hcl
# test.tftest.hcl
mock_provider "aws" {
  mock_resource "aws_instance" {
    defaults = {
      id            = "i-mock123"
      public_ip     = "1.2.3.4"
      instance_type = "t3.micro"
    }
  }

  mock_data "aws_ami" {
    defaults = {
      id           = "ami-mock123"
      architecture = "x86_64"
    }
  }
}

run "test_with_mock" {
  command = plan

  assert {
    condition     = aws_instance.web.instance_type == "t3.micro"
    error_message = "Instance type should be t3.micro"
  }
}
```

### .tofu File Extension (1.8+)

When both `main.tf` and `main.tofu` exist, OpenTofu uses `main.tofu` and ignores `main.tf`. This allows dual compatibility:

```
project/
  main.tf       # Terraform-compatible configuration
  main.tofu     # OpenTofu-specific overrides (uses state encryption, etc.)
  variables.tf  # Shared (no .tofu override needed)
```

### encrypted_metadata_alias (1.9+)

```hcl
terraform {
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.passphrase
    }

    method "aes_gcm" "default" {
      keys = key_provider.pbkdf2.main
    }

    state {
      method                   = method.aes_gcm.default
      encrypted_metadata_alias = "my-state-v1"
    }
  }
}
```

## Checkov - Policy Scanner

```bash
# Install
pip install checkov

# Scan Terraform directory
checkov -d .

# Scan specific file
checkov -f main.tf

# Output as JSON
checkov -d . --output json

# Skip specific checks
checkov -d . --skip-check CKV_AWS_18,CKV_AWS_21

# Scan with custom policy
checkov -d . --external-checks-dir ./policies
```

## Authentication Patterns

### AWS Authentication

```hcl
# Environment variables (recommended for CI/CD)
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN

# Shared credentials file
provider "aws" {
  region  = "us-east-1"
  profile = "production"
}

# OIDC with GitHub Actions (no static credentials)
# Configure AWS IAM Identity Provider for GitHub
# Then use in workflow:
# - uses: aws-actions/configure-aws-credentials@v4
#   with:
#     role-to-assume: arn:aws:iam::123456789012:role/GitHubActions
#     aws-region: us-east-1
```

### GCP Authentication

```bash
# Application Default Credentials
gcloud auth application-default login

# Service account key (CI/CD)
export GOOGLE_CREDENTIALS=$(cat service-account.json)

# Workload Identity Federation (recommended for CI/CD)
# No static credentials needed
```

### Azure Authentication

```bash
# Azure CLI
az login

# Service Principal (CI/CD)
export ARM_CLIENT_ID="..."
export ARM_CLIENT_SECRET="..."
export ARM_SUBSCRIPTION_ID="..."
export ARM_TENANT_ID="..."

# Managed Identity (recommended when running on Azure)
provider "azurerm" {
  features {}
  use_msi = true
}
```

## GitLab CI/CD Pipeline

```yaml
# .gitlab-ci.yml
stages:
  - validate
  - plan
  - apply

variables:
  TF_ROOT: ${CI_PROJECT_DIR}

validate:
  stage: validate
  script:
    - terraform init -backend=false
    - terraform fmt -check -recursive
    - terraform validate
    - tflint --init && tflint --recursive
    - trivy config --severity HIGH,CRITICAL .

plan:
  stage: plan
  script:
    - terraform init
    - terraform plan -out=tfplan
  artifacts:
    paths:
      - tfplan

apply:
  stage: apply
  script:
    - terraform init
    - terraform apply tfplan
  when: manual
  only:
    - main
```

## Atlantis (Pull Request Automation)

```yaml
# atlantis.yaml
version: 3
projects:
  - name: networking
    dir: environments/prod/networking
    workspace: default
    autoplan:
      when_modified: ["*.tf", "*.tfvars"]
      enabled: true
    apply_requirements: [approved, mergeable]

  - name: compute
    dir: environments/prod/compute
    workspace: default
    autoplan:
      when_modified: ["*.tf", "*.tfvars"]
      enabled: true
    apply_requirements: [approved, mergeable]
```

## Terragrunt (DRY Wrapper)

Terragrunt is a thin wrapper around Terraform/OpenTofu that provides DRY configuration, remote state management, and dependency orchestration:

```hcl
# terragrunt.hcl (root)
remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket         = "my-terraform-state"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true
  }
}

# terragrunt.hcl (child module)
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../modules/vpc"
}

inputs = {
  cidr_block = "10.0.0.0/16"
  name       = "production"
}
```

```bash
# Run in current directory
terragrunt plan
terragrunt apply

# Run across all modules
terragrunt run-all plan
terragrunt run-all apply
```
