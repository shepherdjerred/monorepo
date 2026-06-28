# arr_api_keys is taken as a raw JSON object string (see variables.tf) and
# validated there before this runs. Decode it once so providers.tf can index
# the per-app REST API keys; jsondecode of the (already-validated) value cannot
# fail here.
locals {
  arr_api_keys = jsondecode(var.arr_api_keys)
}
