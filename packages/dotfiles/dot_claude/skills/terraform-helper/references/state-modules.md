# State Management & Modules Reference

## State Management

### What is State?

Terraform state (`terraform.tfstate`) maps real-world resources to your configuration, tracks metadata, and improves performance for large infrastructures. State must be stored remotely for team collaboration.

### Remote Backends

#### S3 Backend (AWS)

```hcl
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "prod/network/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true  # S3-native locking (recommended, replaces DynamoDB)

    # DynamoDB locking (deprecated, will be removed in future version)
    # dynamodb_table = "terraform-locks"
  }
}
```

Bootstrap the S3 bucket and (optionally) DynamoDB table before using:

```bash
# Create state bucket
aws s3api create-bucket \
  --bucket my-terraform-state \
  --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket my-terraform-state \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket my-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]
  }'

# Block public access
aws s3api put-public-access-block \
  --bucket my-terraform-state \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

#### GCS Backend (Google Cloud)

```hcl
terraform {
  backend "gcs" {
    bucket = "my-terraform-state"
    prefix = "prod/network"
  }
}
```

#### Azure Backend

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "terraform-state"
    storage_account_name = "tfstate12345"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}
```

#### HCP Terraform / Terraform Cloud

```hcl
terraform {
  cloud {
    organization = "my-org"
    workspaces {
      name = "my-workspace"
    }
  }
}
```

#### Consul Backend

```hcl
terraform {
  backend "consul" {
    address = "consul.example.com:8500"
    scheme  = "https"
    path    = "terraform/state/prod"
  }
}
```

#### PostgreSQL Backend

```hcl
terraform {
  backend "pg" {
    conn_str = "postgres://user:pass@db.example.com/terraform_state?sslmode=require"
  }
}
```

### Backend Configuration from File

```hcl
# backend.hcl
bucket         = "my-state-bucket"
key            = "prod/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
use_lockfile   = true
```

```bash
terraform init -backend-config=backend.hcl
```

### State Locking

State locking prevents concurrent operations that could corrupt state. Most remote backends support locking natively:

- **S3**: Native S3 lockfile (recommended) or DynamoDB (deprecated)
- **GCS**: Built-in locking via GCS object metadata
- **Azure**: Built-in locking via blob leases
- **Consul**: Built-in locking via Consul sessions
- **HCP Terraform**: Built-in locking

```bash
# Force-unlock if a lock is stuck (dangerous - confirm no other operations running)
terraform force-unlock LOCK_ID
```

### State Manipulation

```bash
# List all resources in state
terraform state list

# Show resource details
terraform state show aws_instance.web

# Move resource to new address (rename)
terraform state mv aws_instance.old aws_instance.new

# Move resource into a module
terraform state mv aws_instance.web module.compute.aws_instance.web

# Move module to new name
terraform state mv module.old_name module.new_name

# Remove resource from state (does NOT destroy)
terraform state rm aws_instance.legacy

# Import existing resource into state
terraform import aws_instance.web i-1234567890abcdef0

# Pull remote state to local file
terraform state pull > state.json

# Push local state to remote (dangerous)
terraform state push state.json

# Replace provider in state
terraform state replace-provider hashicorp/aws registry.example.com/aws
```

Prefer `moved` blocks (Terraform 1.1+) and `import` blocks (Terraform 1.5+) over `terraform state mv` and `terraform import` commands for reproducibility and code review.

### State File Structure

```json
{
  "version": 4,
  "terraform_version": "1.10.0",
  "serial": 42,
  "lineage": "unique-uuid",
  "outputs": {
    "instance_ip": {
      "value": "10.0.1.5",
      "type": "string"
    }
  },
  "resources": [
    {
      "mode": "managed",
      "type": "aws_instance",
      "name": "web",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        {
          "schema_version": 1,
          "attributes": {
            "id": "i-1234567890abcdef0",
            "ami": "ami-0c55b159cbfafe1f0",
            "instance_type": "t3.micro"
          }
        }
      ]
    }
  ]
}
```

Never edit state files manually. Use `terraform state` commands or the Terraform CLI.

### OpenTofu State Encryption

```hcl
# PBKDF2 key provider (passphrase-based)
terraform {
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.encryption_passphrase
    }

    method "aes_gcm" "default" {
      keys = key_provider.pbkdf2.main
    }

    state {
      method = method.aes_gcm.default
    }

    plan {
      method = method.aes_gcm.default
    }
  }
}

# AWS KMS key provider
terraform {
  encryption {
    key_provider "aws_kms" "main" {
      kms_key_id = "alias/terraform-state"
      region     = "us-east-1"
      key_spec   = "AES_256"
    }

    method "aes_gcm" "default" {
      keys = key_provider.aws_kms.main
    }

    state {
      method = method.aes_gcm.default
    }
  }
}

# GCP KMS key provider
terraform {
  encryption {
    key_provider "gcp_kms" "main" {
      kms_encryption_key = "projects/my-project/locations/global/keyRings/terraform/cryptoKeys/state"
      key_length         = 32
    }

    method "aes_gcm" "default" {
      keys = key_provider.gcp_kms.main
    }

    state {
      method = method.aes_gcm.default
    }
  }
}
```

Migrating to encryption:

```hcl
terraform {
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.encryption_passphrase
    }

    method "aes_gcm" "new_method" {
      keys = key_provider.pbkdf2.main
    }

    # Use unencrypted as fallback during migration
    method "unencrypted" "migration" {}

    state {
      method   = method.aes_gcm.new_method
      fallback {
        method = method.unencrypted.migration
      }
    }
  }
}
```

## Workspaces

### When to Use Workspaces

Workspaces are best for:
- Feature branch testing with identical infrastructure
- Short-lived environments (PR previews, experiments)
- Slight variations of the same configuration

Avoid workspaces for:
- Long-lived environment separation (dev/staging/prod) - use directory structure instead
- Configurations that differ significantly between environments

### Workspace Commands

```bash
# List workspaces
terraform workspace list

# Create new workspace
terraform workspace new staging

# Select workspace
terraform workspace select staging

# Show current workspace
terraform workspace show

# Delete workspace (must switch away first)
terraform workspace select default
terraform workspace delete staging
```

### Using Workspace in Configuration

```hcl
resource "aws_instance" "web" {
  instance_type = terraform.workspace == "prod" ? "t3.large" : "t3.micro"

  tags = {
    Environment = terraform.workspace
    Name        = "web-${terraform.workspace}"
  }
}

# Backend with workspace prefix
terraform {
  backend "s3" {
    bucket               = "my-state"
    key                  = "terraform.tfstate"
    region               = "us-east-1"
    workspace_key_prefix = "environments"
    # State path: environments/{workspace}/terraform.tfstate
  }
}
```

### Directory-Based Environment Separation (Preferred)

```
infrastructure/
  modules/
    vpc/
    compute/
    database/
  environments/
    dev/
      main.tf          # Calls shared modules
      variables.tf
      terraform.tfvars # Dev-specific values
      backend.tf       # Dev state backend
    staging/
      main.tf
      variables.tf
      terraform.tfvars
      backend.tf
    prod/
      main.tf
      variables.tf
      terraform.tfvars
      backend.tf
```

## Modules

### Module Structure

```
modules/
  vpc/
    main.tf           # Resources
    variables.tf      # Input variables
    outputs.tf        # Output values
    versions.tf       # Provider/Terraform constraints
    README.md         # Documentation
    examples/         # Usage examples (optional)
      basic/
        main.tf
    tests/            # Module tests (optional)
      vpc_test.tftest.hcl
```

### Calling Modules

```hcl
# Local module
module "vpc" {
  source = "./modules/vpc"

  cidr_block = "10.0.0.0/16"
  name       = "production"
}

# Terraform Registry module
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "production"
  cidr = "10.0.0.0/16"
}

# GitHub module
module "vpc" {
  source = "github.com/org/terraform-aws-vpc?ref=v2.0.0"
}

# Generic Git module
module "vpc" {
  source = "git::https://example.com/modules.git//vpc?ref=v1.0.0"
}

# S3 module
module "vpc" {
  source = "s3::https://s3-eu-west-1.amazonaws.com/my-modules/vpc.zip"
}

# GCS module
module "vpc" {
  source = "gcs::https://www.googleapis.com/storage/v1/modules/vpc.zip"
}
```

### Module Versioning

```hcl
# Exact version
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.2"
}

# Pessimistic constraint (allows patch updates)
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.1"  # >= 5.1.0 and < 6.0.0
}

# Range constraint
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = ">= 5.0, < 6.0"
}
```

### Module Inputs and Outputs

```hcl
# modules/vpc/variables.tf
variable "cidr_block" {
  type        = string
  description = "CIDR block for the VPC"
}

variable "name" {
  type        = string
  description = "Name prefix for resources"
}

variable "private_subnets" {
  type        = list(string)
  default     = []
  description = "List of private subnet CIDR blocks"
}

# modules/vpc/outputs.tf
output "vpc_id" {
  value       = aws_vpc.main.id
  description = "ID of the created VPC"
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "List of private subnet IDs"
}
```

```hcl
# Root module - using module outputs
module "vpc" {
  source     = "./modules/vpc"
  cidr_block = "10.0.0.0/16"
  name       = "prod"
}

module "compute" {
  source    = "./modules/compute"
  vpc_id    = module.vpc.vpc_id
  subnet_id = module.vpc.private_subnet_ids[0]
}
```

### Module Composition Patterns

#### Flat Composition

```hcl
# Root module calls all modules directly
module "networking" {
  source = "./modules/networking"
}

module "database" {
  source    = "./modules/database"
  vpc_id    = module.networking.vpc_id
  subnet_ids = module.networking.private_subnet_ids
}

module "application" {
  source      = "./modules/application"
  vpc_id      = module.networking.vpc_id
  subnet_ids  = module.networking.private_subnet_ids
  db_endpoint = module.database.endpoint
}
```

#### Layered Composition

```hcl
# Layer 1: Foundation (network, DNS, IAM)
# Layer 2: Data (databases, caches, queues)
# Layer 3: Compute (ECS, EKS, Lambda)
# Layer 4: Edge (CDN, WAF, load balancers)

# Each layer in separate state, connected via remote state data sources
data "terraform_remote_state" "networking" {
  backend = "s3"
  config = {
    bucket = "state-bucket"
    key    = "networking/terraform.tfstate"
    region = "us-east-1"
  }
}

module "database" {
  source     = "./modules/database"
  vpc_id     = data.terraform_remote_state.networking.outputs.vpc_id
  subnet_ids = data.terraform_remote_state.networking.outputs.private_subnet_ids
}
```

#### Facade Module

```hcl
# modules/application-stack/main.tf
# Wraps multiple lower-level modules into a single high-level module

module "vpc" {
  source     = "../vpc"
  cidr_block = var.cidr_block
  name       = var.name
}

module "rds" {
  source      = "../rds"
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.private_subnet_ids
  db_name     = var.db_name
  engine      = "postgres"
}

module "ecs" {
  source      = "../ecs"
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.private_subnet_ids
  db_endpoint = module.rds.endpoint
}
```

### Module Testing (Terraform 1.6+)

```hcl
# tests/vpc_test.tftest.hcl

variables {
  cidr_block = "10.0.0.0/16"
  name       = "test"
}

run "creates_vpc" {
  command = plan

  assert {
    condition     = aws_vpc.main.cidr_block == "10.0.0.0/16"
    error_message = "VPC CIDR block is incorrect."
  }
}

run "creates_subnets" {
  command = plan

  assert {
    condition     = length(aws_subnet.private) > 0
    error_message = "No private subnets created."
  }
}

# Apply test (creates real resources)
run "integration_test" {
  command = apply

  assert {
    condition     = output.vpc_id != ""
    error_message = "VPC ID should not be empty."
  }
}

# Terraform 1.10+: skip_cleanup to keep resources for debugging
run "debug_test" {
  command      = apply
  skip_cleanup = true
}
```

```bash
# Run all tests
terraform test

# Run specific test file
terraform test -filter=tests/vpc_test.tftest.hcl

# Verbose output
terraform test -verbose
```

## Dependency Management

### Implicit Dependencies

Terraform automatically detects dependencies through resource references:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

# Implicit dependency on aws_vpc.main via reference
resource "aws_subnet" "web" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
```

### Explicit Dependencies

Use `depends_on` when there is a hidden dependency Terraform cannot detect:

```hcl
resource "aws_iam_role_policy" "example" {
  role   = aws_iam_role.example.name
  policy = data.aws_iam_policy_document.example.json
}

resource "aws_instance" "example" {
  ami           = "ami-abc123"
  instance_type = "t3.micro"

  # Ensure IAM policy is attached before launching instance
  depends_on = [aws_iam_role_policy.example]
}
```

### Resource Graph

```bash
# Generate dependency graph
terraform graph | dot -Tsvg > graph.svg

# Graph for plan
terraform graph -type=plan

# Graph for specific resource
terraform graph -type=plan -target=aws_instance.web
```

## terraform_data Resource

The `terraform_data` resource (replacement for `null_resource`) stores arbitrary values and can trigger replacements:

```hcl
resource "terraform_data" "version" {
  input = var.app_version
}

resource "aws_instance" "web" {
  ami           = var.ami
  instance_type = var.instance_type

  lifecycle {
    replace_triggered_by = [terraform_data.version]
  }
}

# Store computed values for later use
resource "terraform_data" "deployment_info" {
  input = {
    deployed_at = timestamp()
    version     = var.app_version
    commit      = var.git_sha
  }
}

output "deployment_info" {
  value = terraform_data.deployment_info.output
}
```
