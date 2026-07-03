variable "asuswrt_username" {
  description = "Admin username for the Asus routers/APs (same on all three). Set via TF_VAR_asuswrt_username."
  type        = string
}

variable "asuswrt_password" {
  description = "Admin password for the Asus routers/APs (same on all three). Set via TF_VAR_asuswrt_password."
  type        = string
  sensitive   = true
}
