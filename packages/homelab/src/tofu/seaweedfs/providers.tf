terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.55"
    }
  }
}

provider "aws" {
  access_key                  = var.seaweedfs_access_key_id
  secret_key                  = var.seaweedfs_secret_access_key
  region                      = "us-east-1"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    s3 = "https://seaweedfs-s3.tailnet-1a49.ts.net"
  }
}
