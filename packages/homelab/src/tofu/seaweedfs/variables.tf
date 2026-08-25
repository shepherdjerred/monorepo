variable "seaweedfs_access_key_id" {
  description = "SeaweedFS S3 deployment identity access key"
  type        = string
  sensitive   = true
}

variable "seaweedfs_secret_access_key" {
  description = "SeaweedFS S3 deployment identity secret key"
  type        = string
  sensitive   = true
}
