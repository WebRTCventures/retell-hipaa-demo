# Implementation Plan: FreePBX Terraform Infrastructure

## Overview

This plan implements a Terraform module that provisions a complete FreePBX 17 infrastructure on AWS. The implementation proceeds file-by-file, starting with variable definitions and data sources, then networking and security, then the EC2 instance and outputs. Each task builds incrementally so the module is always in a valid state. Validation is performed using `terraform validate` and `terraform fmt -check`.

## Tasks

- [ ] 1. Create project structure and input variables
  - [ ] 1.1 Create `terraform/variables.tf` with all input variable definitions
    - Define `aws_region` (string, default "us-east-1")
    - Define `instance_type` (string, default "t3.small")
    - Define `admin_ip` (string, required) with CIDR notation validation block using regex `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/\d{1,2}$`
    - Define `key_pair_name` (string, required)
    - Add descriptions to all variables
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1_

  - [ ] 1.2 Create `terraform/data.tf` with Debian 12 AMI data source
    - Define `aws_ami` data source with `most_recent = true`
    - Set owner to `136693071363` (Debian official AWS account)
    - Add filter for name pattern `debian-12-amd64-*`
    - Add filter for `virtualization-type = hvm`
    - Add filter for `architecture = x86_64`
    - _Requirements: 3.1_

  - [ ] 1.3 Create `terraform/terraform.tfvars.example` with documented example values
    - Include comments explaining each variable
    - Provide example values: `admin_ip = "YOUR_IP/32"`, `key_pair_name = "your-key-pair-name"`
    - Show optional overrides for `aws_region` and `instance_type`
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [ ] 2. Implement networking and security
  - [ ] 2.1 Create `terraform/main.tf` with provider and VPC networking resources
    - Configure AWS provider using `var.aws_region`
    - Define `locals` block with `vpc_cidr = "10.0.0.0/16"`, `subnet_cidr = "10.0.1.0/24"`, Retell IP ranges, port definitions, and tags
    - Create `aws_vpc` resource with the /16 CIDR block and DNS support enabled
    - Create `aws_subnet` resource in the VPC with map_public_ip_on_launch
    - Create `aws_internet_gateway` attached to the VPC
    - Create `aws_route_table` with a default route (0.0.0.0/0) pointing to the IGW
    - Create `aws_route_table_association` linking the route table to the subnet
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 2.2 Create `terraform/security.tf` with security group and all rules
    - Create `aws_security_group` in the VPC
    - Add SIP ingress rules (TCP 5060-5061) from each Retell IP range using `for_each`
    - Add RTP ingress rules (UDP 10000-20000) from each Retell IP range using `for_each`
    - Add HTTPS ingress rule (TCP 443) from `var.admin_ip`
    - Add SSH ingress rule (TCP 22) from `var.admin_ip`
    - Add egress rule allowing all outbound traffic (0.0.0.0/0)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3_

- [ ] 3. Checkpoint - Validate networking configuration
  - Run `terraform validate` and `terraform fmt -check` to ensure no syntax errors in the module so far. Ask the user if questions arise.

- [ ] 4. Implement EC2 instance and outputs
  - [ ] 4.1 Create `terraform/user_data.sh` with FreePBX install script
    - Add shebang and `set -euo pipefail`
    - Redirect all output to `/var/log/freepbx-install.log` via tee
    - Run `apt-get update && apt-get upgrade -y`
    - Download the official Sangoma FreePBX Debian 12 install script from GitHub
    - Execute the install script with bash
    - Add start/end log markers with timestamps
    - _Requirements: 3.2, 3.3_

  - [ ] 4.2 Add EC2 instance and Elastic IP resources to `terraform/main.tf`
    - Create `aws_instance` resource using `data.aws_ami.debian12.id`
    - Set instance type from `var.instance_type`
    - Place in the public subnet
    - Attach the security group
    - Assign `var.key_pair_name` as the key pair
    - Load `user_data.sh` via `templatefile()` or `file()` function
    - Create `aws_eip` resource
    - Create `aws_eip_association` linking EIP to the EC2 instance
    - Add appropriate tags to all resources
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 4.1, 4.2, 4.3, 7.2_

  - [ ] 4.3 Create `terraform/outputs.tf` with all output values
    - Define `freepbx_public_ip` output with the Elastic IP address
    - Define `freepbx_admin_url` output formatted as `"https://<EIP>"`
    - Define `ssh_command` output formatted as `"ssh admin@<EIP>"`
    - Add descriptions to all outputs
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 5. Final validation checkpoint
  - [ ] 5.1 Run `terraform validate` and `terraform fmt -check` on the complete module
    - Ensure the full module passes validation with no errors
    - Ensure formatting is consistent across all files
    - Verify the planned resource count matches expectations (VPC, subnet, IGW, route table, route table association, security group, security group rules, EC2 instance, EIP, EIP association)
    - _Requirements: 10.1, 10.2_

- [ ] 6. Final checkpoint - Ensure all validations pass
  - Ensure all validations pass, ask the user if questions arise.

## Notes

- This is a Terraform (HCL) module — property-based tests do not apply since it's declarative IaC
- Validation uses `terraform validate` and `terraform fmt -check` instead of unit tests
- The user_data script takes ~30 minutes to complete on first boot; `terraform apply` itself finishes in ~2-3 minutes
- The module references an existing AWS key pair rather than generating one (avoids storing private keys in state)
- All Retell IP ranges (18.98.16.120/30, 3.42.144.0/23, 143.223.88.0/21, 161.115.160.0/19) must be included in security group rules
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation of the Terraform configuration

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3"] },
    { "id": 4, "tasks": ["5.1"] }
  ]
}
```
