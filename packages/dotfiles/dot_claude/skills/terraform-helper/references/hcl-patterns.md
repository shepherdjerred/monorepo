# HCL Patterns Reference

## Variables

### Basic Types

```hcl
variable "name" {
  type    = string
  default = "web-server"
}

variable "port" {
  type    = number
  default = 8080
}

variable "enabled" {
  type    = bool
  default = true
}
```

### Collection Types

```hcl
variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "instance_tags" {
  type = map(string)
  default = {
    Environment = "dev"
    Team        = "platform"
  }
}

variable "ingress_rules" {
  type = list(object({
    port        = number
    protocol    = string
    cidr_blocks = list(string)
  }))
  default = []
}

variable "settings" {
  type = object({
    instance_type = string
    volume_size   = number
    enable_monitoring = optional(bool, true)
  })
}

variable "flexible_config" {
  type    = any
  default = {}
}

# Tuple type (fixed-length, mixed types)
variable "rule" {
  type = tuple([string, number, bool])
}

# Set type (unique values, unordered)
variable "allowed_cidrs" {
  type = set(string)
}
```

### Variable Validation

```hcl
variable "instance_type" {
  type = string

  validation {
    condition     = can(regex("^t3\\.", var.instance_type))
    error_message = "Instance type must be in the t3 family."
  }
}

variable "environment" {
  type = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

# Multiple validation blocks (Terraform 1.9+: can reference other vars)
variable "max_instances" {
  type = number

  validation {
    condition     = var.max_instances >= 1
    error_message = "Must have at least 1 instance."
  }

  validation {
    condition     = var.max_instances <= 100
    error_message = "Cannot exceed 100 instances."
  }
}

# Terraform 1.9+: cross-variable validation
variable "min_instances" {
  type = number

  validation {
    condition     = var.min_instances <= var.max_instances
    error_message = "min_instances must be <= max_instances."
  }
}
```

### Sensitive Variables

```hcl
variable "db_password" {
  type      = string
  sensitive = true
}

# Ephemeral variable (Terraform 1.10+) - never stored in state
ephemeral "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "prod/db/password"
}
```

### Setting Variables

```bash
# CLI flag
terraform apply -var="instance_type=t3.large"

# From file (auto-loaded: terraform.tfvars, *.auto.tfvars)
terraform apply -var-file="prod.tfvars"

# Environment variable
export TF_VAR_instance_type="t3.large"
```

## Outputs

```hcl
# Basic output
output "instance_id" {
  value = aws_instance.web.id
}

# With description and sensitivity
output "db_connection_string" {
  value       = "postgres://${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
  description = "PostgreSQL connection string"
  sensitive   = true
}

# Conditional output
output "lb_dns" {
  value       = var.create_lb ? aws_lb.main[0].dns_name : null
  description = "Load balancer DNS name (if created)"
}

# Complex output
output "instance_details" {
  value = {
    id         = aws_instance.web.id
    public_ip  = aws_instance.web.public_ip
    private_ip = aws_instance.web.private_ip
  }
}
```

## Locals

```hcl
locals {
  # Computed values
  name_prefix = "${var.project}-${var.environment}"

  # Common tags
  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    CreatedAt   = timestamp()
  }

  # Conditional logic
  is_production = var.environment == "prod"
  instance_type = local.is_production ? "t3.large" : "t3.micro"

  # Data transformation
  subnet_ids = [for s in aws_subnet.main : s.id]

  # Merging maps
  all_tags = merge(local.common_tags, var.extra_tags)

  # Flattening nested structures
  security_group_rules = flatten([
    for sg_key, sg in var.security_groups : [
      for rule in sg.rules : {
        sg_key      = sg_key
        port        = rule.port
        protocol    = rule.protocol
        cidr_blocks = rule.cidr_blocks
      }
    ]
  ])
}
```

## Data Sources

```hcl
# Query existing resources
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  tags = {
    Tier = "private"
  }
}

# Read file
data "local_file" "config" {
  filename = "${path.module}/config.json"
}

# Template rendering
data "template_file" "user_data" {
  template = file("${path.module}/userdata.sh.tpl")
  vars = {
    hostname = var.hostname
    port     = var.port
  }
}

# External data source (call script)
data "external" "result" {
  program = ["python3", "${path.module}/script.py"]

  query = {
    id = var.resource_id
  }
}

# Remote state
data "terraform_remote_state" "networking" {
  backend = "s3"
  config = {
    bucket = "my-state-bucket"
    key    = "networking/terraform.tfstate"
    region = "us-east-1"
  }
}
```

## Dynamic Blocks

```hcl
# Basic dynamic block
resource "aws_security_group" "main" {
  name   = "main"
  vpc_id = var.vpc_id

  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      protocol    = ingress.value.protocol
      cidr_blocks = ingress.value.cidr_blocks
    }
  }
}

# Nested dynamic blocks
resource "aws_autoscaling_group" "example" {
  # ...

  dynamic "tag" {
    for_each = var.tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

# Conditional dynamic block
resource "aws_instance" "web" {
  ami           = var.ami
  instance_type = var.instance_type

  dynamic "ebs_block_device" {
    for_each = var.additional_volumes != null ? var.additional_volumes : []
    content {
      device_name = ebs_block_device.value.device_name
      volume_size = ebs_block_device.value.size
      volume_type = ebs_block_device.value.type
    }
  }
}

# Dynamic with iterator alias
resource "aws_security_group" "main" {
  dynamic "ingress" {
    for_each = var.service_ports
    iterator = port

    content {
      from_port   = port.value
      to_port     = port.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
}
```

## for_each and count

### count

```hcl
# Simple count
resource "aws_instance" "server" {
  count         = 3
  ami           = var.ami
  instance_type = var.instance_type
  tags = {
    Name = "server-${count.index}"
  }
}

# Conditional resource creation
resource "aws_lb" "main" {
  count = var.create_lb ? 1 : 0
  name  = "${var.name}-lb"
  # ...
}

# Reference count resources
output "instance_ids" {
  value = aws_instance.server[*].id
}
```

### for_each with Map

```hcl
resource "aws_iam_user" "users" {
  for_each = toset(["alice", "bob", "charlie"])
  name     = each.key
}

resource "aws_instance" "servers" {
  for_each = {
    web = { type = "t3.small", az = "us-east-1a" }
    api = { type = "t3.medium", az = "us-east-1b" }
    db  = { type = "r5.large", az = "us-east-1c" }
  }

  ami               = var.ami
  instance_type     = each.value.type
  availability_zone = each.value.az

  tags = {
    Name = each.key
  }
}

# Reference for_each resources
output "server_ips" {
  value = { for k, v in aws_instance.servers : k => v.public_ip }
}
```

### for_each with Modules

```hcl
module "vpc" {
  for_each = {
    us-east = { region = "us-east-1", cidr = "10.0.0.0/16" }
    us-west = { region = "us-west-2", cidr = "10.1.0.0/16" }
  }

  source  = "./modules/vpc"
  region  = each.value.region
  cidr    = each.value.cidr
  name    = each.key
}
```

### count vs for_each

Prefer `for_each` over `count` when:
- Resources have meaningful identifiers (not just numeric index)
- Removing an item from the middle should not affect others
- Resources are heterogeneous (different configurations)

Use `count` for:
- Simple conditional creation (`count = var.enabled ? 1 : 0`)
- Creating N identical resources

## Conditional Expressions

```hcl
# Ternary operator
instance_type = var.environment == "prod" ? "t3.large" : "t3.micro"

# Conditional resource creation
resource "aws_eip" "web" {
  count    = var.assign_eip ? 1 : 0
  instance = aws_instance.web.id
}

# Conditional value in map
locals {
  config = {
    replicas = var.environment == "prod" ? 3 : 1
    domain   = var.environment == "prod" ? "example.com" : "${var.environment}.example.com"
  }
}

# Null coalescing pattern
region = coalesce(var.region, data.aws_region.current.name)

# try() for safe attribute access
output "endpoint" {
  value = try(aws_db_instance.main[0].endpoint, "not-created")
}
```

## for Expressions

```hcl
# Transform list
locals {
  upper_names = [for name in var.names : upper(name)]
}

# Filter list
locals {
  large_instances = [for i in var.instances : i if i.size == "large"]
}

# Transform list to map
locals {
  instance_map = { for i in var.instances : i.name => i.id }
}

# Nested for
locals {
  all_rules = flatten([
    for group, rules in var.security_groups : [
      for rule in rules : {
        group    = group
        port     = rule.port
        protocol = rule.protocol
      }
    ]
  ])
}

# Grouping with ...
locals {
  users_by_role = { for u in var.users : u.role => u.name... }
  # Result: { admin = ["alice", "bob"], developer = ["charlie"] }
}
```

## Type Constraints and Functions

### Common Functions

```hcl
# String
join(", ", ["a", "b", "c"])           # "a, b, c"
split(",", "a,b,c")                   # ["a", "b", "c"]
format("Hello, %s!", var.name)         # "Hello, World!"
replace("hello-world", "-", "_")       # "hello_world"
trimspace("  hello  ")                 # "hello"
lower("HELLO")                         # "hello"
upper("hello")                         # "HELLO"
substr("hello", 0, 3)                  # "hel"
regex("^([a-z]+)-([0-9]+)$", "web-42") # ["web", "42"]
startswith("hello", "he")              # true
endswith("hello", "lo")               # true

# Collection
length(["a", "b", "c"])               # 3
element(["a", "b", "c"], 1)           # "b"
contains(["a", "b"], "a")             # true
concat(["a"], ["b"], ["c"])           # ["a", "b", "c"]
flatten([["a", "b"], ["c"]])          # ["a", "b", "c"]
distinct(["a", "b", "a"])             # ["a", "b"]
sort(["b", "a", "c"])                 # ["a", "b", "c"]
reverse(["a", "b", "c"])              # ["c", "b", "a"]
slice(["a", "b", "c", "d"], 1, 3)     # ["b", "c"]
compact(["a", "", "b", null])          # ["a", "b"]
coalesce("", "hello")                  # "hello"
coalescelist([], ["a", "b"])           # ["a", "b"]
zipmap(["a", "b"], [1, 2])            # {a=1, b=2}

# Map
merge({a=1}, {b=2})                   # {a=1, b=2}
lookup({a=1, b=2}, "a", 0)            # 1
keys({a=1, b=2})                      # ["a", "b"]
values({a=1, b=2})                    # [1, 2]

# Numeric
min(1, 2, 3)                          # 1
max(1, 2, 3)                          # 3
abs(-5)                               # 5
ceil(4.3)                             # 5
floor(4.7)                            # 4
parseint("FF", 16)                    # 255

# Encoding
jsonencode({a = 1})                   # "{\"a\":1}"
jsondecode("{\"a\":1}")               # {a = 1}
yamlencode({a = 1})                   # "a: 1\n"
yamldecode("a: 1")                    # {a = "1"}
base64encode("hello")                 # "aGVsbG8="
base64decode("aGVsbG8=")              # "hello"
urlencode("hello world")              # "hello+world"

# Filesystem
file("${path.module}/file.txt")        # Read file contents
fileexists("${path.module}/file.txt")  # Check existence
templatefile("tpl.sh", {name = "web"}) # Render template
filebase64("${path.module}/cert.pem")  # Read and base64 encode
fileset(path.module, "*.tf")           # Glob file patterns

# IP/CIDR
cidrsubnet("10.0.0.0/16", 8, 1)       # "10.0.1.0/24"
cidrhost("10.0.1.0/24", 5)            # "10.0.1.5"
cidrnetmask("10.0.0.0/16")            # "255.255.0.0"

# Type conversion
tostring(42)                           # "42"
tonumber("42")                         # 42
tobool("true")                        # true
tolist(toset(["a", "b"]))             # ["a", "b"]
toset(["a", "b", "a"])                # toset(["a", "b"])
tomap({a = 1})                        # {a = 1}

# Error handling
try(var.optional.nested.value, "default")
can(regex("^[a-z]+$", var.name))      # true/false without error
```

### Provider-Defined Functions (Terraform 1.8+)

```hcl
# AWS provider functions
locals {
  parsed_arn = provider::aws::arn_parse("arn:aws:s3:::my-bucket")
  # parsed_arn.service == "s3"
  # parsed_arn.account_id == ""
  # parsed_arn.resource == "my-bucket"
}

# Kubernetes provider functions
locals {
  manifest = provider::kubernetes::manifest_decode(file("deployment.yaml"))
}
```

### templatestring Function (Terraform 1.9+)

```hcl
# Render template from dynamic source (no file needed)
locals {
  template_content = data.http.template.response_body
  rendered         = templatestring(local.template_content, {
    name = var.app_name
    port = var.app_port
  })
}
```

## Moved Blocks

```hcl
# Rename a resource
moved {
  from = aws_instance.web_server
  to   = aws_instance.app_server
}

# Move resource into a module
moved {
  from = aws_s3_bucket.logs
  to   = module.logging.aws_s3_bucket.logs
}

# Move between modules
moved {
  from = module.old_network.aws_subnet.main
  to   = module.new_network.aws_subnet.main
}

# Convert count to for_each
moved {
  from = aws_instance.server[0]
  to   = aws_instance.server["primary"]
}

# Cross-type refactoring (Terraform 1.8+, provider support required)
moved {
  from = null_resource.setup
  to   = terraform_data.setup
}

# Terraform 1.9+: null_resource to terraform_data
moved {
  from = null_resource.provisioner
  to   = terraform_data.provisioner
}
```

Keep moved blocks in your configuration as a permanent record. Removing them tells Terraform the old address no longer exists and may trigger resource destruction.

## Import Blocks (Terraform 1.5+)

```hcl
# Declarative import
import {
  to = aws_instance.web
  id = "i-1234567890abcdef0"
}

import {
  to = aws_s3_bucket.data
  id = "my-existing-bucket"
}

# Import with for_each (Terraform 1.6+)
import {
  for_each = var.existing_instances
  to       = aws_instance.imported[each.key]
  id       = each.value
}
```

### Import Workflow

```bash
# 1. Write import blocks in .tf files

# 2. Generate matching resource configuration
terraform plan -generate-config-out=generated.tf

# 3. Review and adjust generated.tf

# 4. Apply to import into state
terraform apply
```

Note: Import blocks do not support `count` or conditional expressions. The `id` must be known at plan time.

## Lifecycle Meta-Arguments

```hcl
resource "aws_instance" "web" {
  # ...

  lifecycle {
    # Prevent destruction
    prevent_destroy = true

    # Ignore changes to specific attributes
    ignore_changes = [
      tags,
      ami,
    ]

    # Ignore all changes (manage externally)
    ignore_changes = all

    # Create new before destroying old
    create_before_destroy = true

    # Replace when expression changes
    replace_triggered_by = [
      aws_ami.app.id,
      null_resource.config_hash.id,
    ]

    # Custom precondition
    precondition {
      condition     = data.aws_ami.app.architecture == "x86_64"
      error_message = "AMI must be x86_64 architecture."
    }

    # Custom postcondition
    postcondition {
      condition     = self.public_ip != ""
      error_message = "Instance must have a public IP."
    }
  }
}
```

## Removed Blocks (Terraform 1.7+)

```hcl
# Remove resource from state without destroying
removed {
  from = aws_instance.old_server

  lifecycle {
    destroy = false
  }
}

# Remove and destroy (Terraform 1.9+: supports provisioners)
removed {
  from = aws_instance.decommissioned

  provisioner "local-exec" {
    when    = destroy
    command = "echo 'Decommissioning ${self.id}'"
  }
}
```

## Check Blocks (Terraform 1.5+)

```hcl
check "health_check" {
  data "http" "app" {
    url = "https://${aws_lb.main.dns_name}/health"
  }

  assert {
    condition     = data.http.app.status_code == 200
    error_message = "Application health check failed."
  }
}
```

## Ephemeral Resources (Terraform 1.10+)

```hcl
# Ephemeral resource - never stored in state
ephemeral "aws_secretsmanager_secret_version" "db" {
  secret_id = "prod/db/password"
}

# Ephemeral variable
variable "api_token" {
  type      = string
  ephemeral = true
}

# Ephemeral output
output "temp_token" {
  value     = ephemeral.aws_secretsmanager_secret_version.db.secret_string
  ephemeral = true
}

# Write-only arguments (Terraform 1.11+)
resource "aws_db_instance" "main" {
  # ...
  password_wo         = ephemeral.aws_secretsmanager_secret_version.db.secret_string
  password_wo_version = 1  # Increment to trigger update
}
```
