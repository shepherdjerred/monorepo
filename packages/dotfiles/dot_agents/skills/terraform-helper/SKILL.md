---
name: terraform-helper
description: |
  Terraform and OpenTofu infrastructure as code - HCL, providers, modules, state management, and CLI operations
  When user works with .tf files, mentions Terraform, OpenTofu, tofu, HCL, infrastructure as code, or tf commands
---

# Terraform & OpenTofu Helper Agent

## What's New

### Terraform 1.11 (Latest Stable)

- **Write-Only Arguments**: Extend ephemeral values to managed resources; write-only arguments accept ephemeral values and are never persisted in plan or state files (e.g., `password_wo` on `aws_db_instance`)
- **Write-Only Versioning**: Use `_wo_version` attributes to control when write-only values are re-sent to providers

### Terraform 1.10

- **Ephemeral Values**: Ephemeral input/output variables, ephemeral resources, and `ephemeralasnull` function; secrets never stored in state or plan files
- **Ephemeral Resources**: Available in AWS, Azure, Kubernetes, and random providers for temporary credentials, tokens, and tunnels
- **`terraform.applying` Function**: Distinguish between plan and apply phases in expressions
- **Performance**: Refactored plan changes and reduced repeated state decoding
- **Testing**: Backend blocks in run blocks, `skip_cleanup` attribute for test files

### Terraform 1.9

- **Enhanced Variable Validation**: Validation conditions can reference other variables, data sources, and locals
- **`templatestring` Function**: Render templates from dynamic sources without saving to disk
- **Moved Block Improvements**: Refactor `null_resource` to `terraform_data` via moved blocks
- **Provisioner in `removed` Blocks**: Execute destroy-time provisioners when removing resource declarations

### Terraform 1.8

- **Provider-Defined Functions**: Call custom provider functions with `provider::name::function()` syntax
- **Cross-Type Refactoring**: Move resources between different types using moved blocks (provider support required)
- **Provider Functions for AWS/GCP/K8s**: ARN parsing, resource ID parsing, manifest encoding/decoding

### OpenTofu 1.9

- **`for_each` on Providers**: Aliased provider configurations support `for_each` for dynamic multi-instance providers
- **`-exclude` Flag**: Exclude specific resources from plan/apply operations
- **Early Evaluation Prompts**: Interactive variable prompting during early evaluation phase
- **`encrypted_metadata_alias`**: Explicit ID control for encrypted state data

### OpenTofu 1.8

- **`.tofu` File Extension**: OpenTofu-specific files that override identically named `.tf` files for dual compatibility
- **Early Evaluation**: Use variables and locals in backend config, module sources, and encryption config
- **Provider Mocking**: Mock providers in test files for isolated unit testing
- **State Encryption**: End-to-end client-side encryption with AES-GCM, PBKDF2, AWS KMS, GCP KMS key providers

## Overview

Terraform and OpenTofu are infrastructure as code (IaC) tools that use HashiCorp Configuration Language (HCL) to define and provision cloud infrastructure declaratively. OpenTofu is an open-source fork (MPL 2.0) of Terraform (BSL licensed), maintaining HCL compatibility while adding features like state encryption and provider `for_each`.

## CLI Commands

### Auto-Approved Commands (Safe / Read-Only)

The following commands are safe to run without user confirmation:

- `terraform plan` / `tofu plan` - Preview changes without applying
- `terraform validate` / `tofu validate` - Check configuration syntax and consistency
- `terraform fmt` / `tofu fmt` - Format HCL files to canonical style
- `terraform fmt -check` - Check formatting without modifying files
- `terraform show` / `tofu show` - Display state or plan file contents
- `terraform state list` / `tofu state list` - List resources in state
- `terraform state show <addr>` - Show attributes of a single resource
- `terraform output` / `tofu output` - Display output values
- `terraform providers` / `tofu providers` - Show required providers
- `terraform version` / `tofu version` - Show version information
- `terraform graph` / `tofu graph` - Generate dependency graph (DOT format)
- `terraform workspace list` - List workspaces
- `terraform console` - Interactive expression evaluation

### Commands Requiring Confirmation

These commands modify infrastructure or state and need user approval:

- `terraform apply` / `tofu apply` - Create or update infrastructure
- `terraform destroy` / `tofu destroy` - Destroy managed infrastructure
- `terraform import` / `tofu import` - Import existing resources into state
- `terraform state mv` - Move resources within state
- `terraform state rm` - Remove resources from state (does not destroy)
- `terraform state push` - Overwrite remote state
- `terraform taint` / `terraform untaint` - Mark/unmark resource for recreation
- `terraform force-unlock` - Manually release a state lock
- `terraform workspace new/delete` - Create or delete workspaces

### Common Workflows

```bash
# Initialize working directory (downloads providers, modules)
terraform init

# Format all .tf files recursively
terraform fmt -recursive

# Validate configuration
terraform validate

# Preview changes
terraform plan

# Preview changes and save plan
terraform plan -out=tfplan

# Apply saved plan (no confirmation prompt)
terraform apply tfplan

# Apply with auto-approve (use cautiously)
terraform apply -auto-approve

# Apply targeting specific resources
terraform plan -target=aws_instance.web
terraform apply -target=aws_instance.web

# Destroy specific resource
terraform destroy -target=aws_instance.web

# Generate plan for destroy
terraform plan -destroy

# Refresh state without apply
terraform apply -refresh-only

# Show outputs in JSON
terraform output -json
```

### Initialization

```bash
# Standard init
terraform init

# Upgrade providers and modules
terraform init -upgrade

# Reconfigure backend (e.g., migrating state)
terraform init -reconfigure

# Migrate state to new backend
terraform init -migrate-state

# Init with backend config from file
terraform init -backend-config=backend.hcl

# Init with backend config as key-value
terraform init -backend-config="bucket=my-state-bucket"
```

### State Inspection

```bash
# List all resources in state
terraform state list

# Show specific resource details
terraform state show aws_instance.web

# Show full state as JSON
terraform show -json

# Pull remote state locally
terraform state pull > state.json

# Show specific output
terraform output db_endpoint
```

## HCL Basics

### File Structure

```
project/
  main.tf          # Core resource definitions
  variables.tf     # Input variable declarations
  outputs.tf       # Output value definitions
  versions.tf      # Terraform and provider version constraints
  terraform.tfvars # Variable values (do not commit secrets)
  locals.tf        # Local value definitions (optional)
  data.tf          # Data source definitions (optional)
  backend.tf       # Backend configuration (optional)
```

### Resource and Data Source Syntax

```hcl
# Resource block
resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = var.instance_type

  tags = {
    Name = "web-server"
  }
}

# Data source (read-only query)
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-*-amd64-server-*"]
  }
}

# Reference data source
resource "aws_instance" "web" {
  ami = data.aws_ami.ubuntu.id
}
```

### Variables, Outputs, and Locals

```hcl
# Variable with validation
variable "instance_type" {
  type        = string
  default     = "t3.micro"
  description = "EC2 instance type"

  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type)
    error_message = "Instance type must be t3.micro, t3.small, or t3.medium."
  }
}

# Output
output "instance_ip" {
  value       = aws_instance.web.public_ip
  description = "Public IP of the web instance"
  sensitive   = false
}

# Locals
locals {
  common_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}
```

### Provider Configuration

```hcl
terraform {
  required_version = ">= 1.8"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# Aliased provider for multi-region
provider "aws" {
  alias  = "west"
  region = "us-west-2"
}

resource "aws_instance" "west_server" {
  provider = aws.west
  # ...
}
```

## OpenTofu Differences from Terraform

| Feature             | Terraform              | OpenTofu                                        |
| ------------------- | ---------------------- | ----------------------------------------------- |
| License             | BSL 1.1                | MPL 2.0 (open source)                           |
| State Encryption    | Not supported natively | Built-in AES-GCM with PBKDF2/KMS                |
| Provider `for_each` | Not supported          | Supported since 1.9                             |
| `.tofu` Files       | Not recognized         | Override `.tf` for OpenTofu-specific code       |
| Early Evaluation    | Not supported          | Variables/locals in backends and module sources |
| Provider Mocking    | Not supported          | Built-in test mocking since 1.8                 |
| Ephemeral Values    | Since 1.10             | Not yet (tracking Terraform)                    |
| Registry            | registry.terraform.io  | registry.opentofu.org (mirrors public)          |
| CLI Binary          | `terraform`            | `tofu`                                          |

### OpenTofu State Encryption Example

```hcl
terraform {
  encryption {
    key_provider "pbkdf2" "mykey" {
      passphrase = var.state_passphrase  # Min 16 chars recommended
    }

    method "aes_gcm" "default" {
      keys = key_provider.pbkdf2.mykey
    }

    state {
      method = method.aes_gcm.default
    }

    plan {
      method = method.aes_gcm.default
    }
  }
}
```

## Tooling Ecosystem

### tflint - Linter

```bash
# Install
brew install tflint

# Initialize plugins
tflint --init

# Run linter
tflint

# Run with specific config
tflint --config .tflint.hcl

# Output as JSON
tflint --format json
```

Configuration (`.tflint.hcl`):

```hcl
plugin "aws" {
  enabled = true
  version = "0.31.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

rule "terraform_naming_convention" {
  enabled = true
}

rule "terraform_unused_declarations" {
  enabled = true
}
```

### Trivy (successor to tfsec) - Security Scanner

```bash
# Scan Terraform directory
trivy config .

# Scan with severity filter
trivy config --severity HIGH,CRITICAL .

# Output as JSON
trivy config --format json --output results.json .

# Scan specific file
trivy config main.tf
```

### Infracost - Cost Estimation

```bash
# Generate cost breakdown
infracost breakdown --path .

# Compare costs between branches
infracost diff --path . --compare-to infracost-base.json

# Generate JSON for CI/CD
infracost breakdown --path . --format json --out-file infracost.json

# Post cost comment on PR
infracost comment github --path infracost.json --repo org/repo --pull-request 123
```

### terraform-docs - Documentation Generator

```bash
# Generate markdown docs from module
terraform-docs markdown table . > README.md

# Generate with config
terraform-docs -c .terraform-docs.yml .
```

## Best Practices

1. **Use remote state** with locking for team collaboration
2. **Pin provider and module versions** using `~>` constraints
3. **Separate environments** with directory structure, not workspaces
4. **Never commit `.tfvars` with secrets** - use environment variables or vault
5. **Run `terraform plan` before every `apply`** and review changes
6. **Use `moved` blocks for refactoring** instead of manual state manipulation
7. **Use `import` blocks (v1.5+)** for declarative resource import
8. **Format and validate in CI** with `terraform fmt -check` and `terraform validate`
9. **Scan for security issues** with tflint and trivy in pre-commit hooks
10. **Use ephemeral values (v1.10+)** for secrets that should not be in state

## References

- [Terraform Documentation](https://developer.hashicorp.com/terraform/docs)
- [OpenTofu Documentation](https://opentofu.org/docs/)
- [Terraform Registry](https://registry.terraform.io/)
- [OpenTofu Registry](https://registry.opentofu.org/)
- [HCL Language Specification](https://github.com/hashicorp/hcl/blob/main/hclsyntax/spec.md)
- [tflint](https://github.com/terraform-linters/tflint)
- [Trivy](https://trivy.dev/)
- [Infracost](https://www.infracost.io/)

## When to Ask for Help

Ask the user for clarification when:

- The target cloud provider or region is ambiguous
- State backend configuration details are missing
- Destructive operations (destroy, state rm, force-unlock) need confirmation
- Provider credentials or authentication method is unclear
- Module source or version constraints conflict
- Multiple workspaces or environments could be affected
