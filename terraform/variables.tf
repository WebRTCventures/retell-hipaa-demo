variable "aws_region" {
  description = "AWS region where the FreePBX infrastructure will be deployed"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type for the FreePBX server"
  type        = string
  default     = "t3.small"
}

variable "admin_ip" {
  description = "Your public IP address in CIDR notation (e.g., 203.0.113.10/32) for SSH and HTTPS access"
  type        = string

  validation {
    condition     = can(regex("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/\\d{1,2}$", var.admin_ip))
    error_message = "The admin_ip must be a valid IP address in CIDR notation (e.g., 203.0.113.10/32)."
  }
}

variable "key_pair_name" {
  description = "Name of an existing AWS key pair to assign to the FreePBX instance for SSH access"
  type        = string
}
