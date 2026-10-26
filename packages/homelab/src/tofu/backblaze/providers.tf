terraform {
  required_version = ">= 1.11.0"

  required_providers {
    b2 = {
      source = "Backblaze/b2"
      # 0.14.1's published signature returns 504, so the lock stays on 0.14.0.
      version = "0.14.0"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 3.0"
    }
  }
}

# Operator-applied. The master key is B2_APPLICATION_KEY_ID and
# B2_APPLICATION_KEY. Create the Backblaze account in us-west-004 so the S3
# endpoint in this stack is the one clients use. CI validates this stack and does not
# plan or apply it.
provider "b2" {}

# Writes each scoped key into its own 1Password item. Authenticates through
# the 1Password desktop app for the account named by OP_ACCOUNT.
provider "onepassword" {}
