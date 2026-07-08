# Requirements Document

## Introduction

This feature provisions a complete FreePBX infrastructure on AWS using Terraform. A single `terraform apply` produces a working FreePBX instance with security groups pre-configured for Retell AI connectivity via SIP trunk. The module handles VPC creation, EC2 instance provisioning with FreePBX/Asterisk installation on Debian 12 (Bookworm), Elastic IP assignment, and security group rules that allow SIP/RTP traffic from Retell AI IP ranges while restricting administrative access to a specified IP.

## Glossary

- **Terraform_Module**: The set of Terraform configuration files (HCL) that define the FreePBX infrastructure resources on AWS
- **FreePBX_Instance**: An EC2 instance running Debian 12 (Bookworm) with Asterisk and FreePBX 17 installed, serving as the PBX system that connects to Retell AI via SIP trunk
- **Security_Group**: An AWS security group that controls inbound and outbound network traffic to the FreePBX_Instance
- **Retell_IP_Ranges**: The set of IP CIDR blocks used by Retell AI for SIP and RTP traffic: 18.98.16.120/30, 3.42.144.0/23, 143.223.88.0/21, 161.115.160.0/19
- **Admin_IP**: A user-provided IP address (via Terraform variable) that is allowed SSH and HTTPS access to the FreePBX_Instance
- **Elastic_IP**: An AWS Elastic IP address attached to the FreePBX_Instance, providing a stable public IP for SIP trunk configuration
- **VPC**: A Virtual Private Cloud with a single public subnet in which the FreePBX_Instance is deployed
- **User_Data_Script**: A shell script executed on first boot of the Debian 12 EC2 instance that installs and configures Asterisk and FreePBX 17 using the official Sangoma install script for Debian 12

## Requirements

### Requirement 1: Terraform Module Variables

**User Story:** As a developer, I want to configure the Terraform module through input variables, so that I can customize the deployment for my environment without modifying the module code.

#### Acceptance Criteria

1. THE Terraform_Module SHALL accept a variable for AWS region with a default value of "us-east-1"
2. THE Terraform_Module SHALL accept a variable for EC2 instance type with a default value of "t3.small"
3. THE Terraform_Module SHALL accept a required variable for Admin_IP in CIDR notation
4. THE Terraform_Module SHALL validate that Admin_IP follows valid CIDR notation format
5. THE Terraform_Module SHALL accept a required variable for an existing AWS key pair name

### Requirement 2: VPC and Networking

**User Story:** As a developer, I want the Terraform module to create a VPC with a public subnet, so that the FreePBX instance has internet connectivity for SIP trunk communication.

#### Acceptance Criteria

1. WHEN `terraform apply` is executed, THE Terraform_Module SHALL create a VPC with a /16 CIDR block
2. WHEN `terraform apply` is executed, THE Terraform_Module SHALL create a single public subnet within the VPC
3. WHEN `terraform apply` is executed, THE Terraform_Module SHALL create an Internet Gateway attached to the VPC
4. WHEN `terraform apply` is executed, THE Terraform_Module SHALL create a route table with a default route (0.0.0.0/0) pointing to the Internet Gateway
5. WHEN `terraform apply` is executed, THE Terraform_Module SHALL associate the route table with the public subnet

### Requirement 3: EC2 Instance Provisioning

**User Story:** As a developer, I want Terraform to provision an EC2 instance with FreePBX installed on Debian 12, so that I have a working PBX system without manual server setup.

#### Acceptance Criteria

1. WHEN `terraform apply` is executed, THE Terraform_Module SHALL launch an EC2 instance using the official Debian 12 (Bookworm) AMI in the public subnet
2. WHEN `terraform apply` is executed, THE Terraform_Module SHALL attach a User_Data_Script that installs Asterisk and FreePBX 17 on the EC2 instance using the official Sangoma Debian 12 install script
3. WHEN the FreePBX_Instance boots, THE User_Data_Script SHALL execute the FreePBX 17 official install script for Debian 12 and start the Asterisk and Apache services
4. THE Terraform_Module SHALL assign the specified SSH key pair to the FreePBX_Instance for remote access
5. THE FreePBX_Instance SHALL have a public IP address assigned via the Elastic_IP

### Requirement 4: Elastic IP Assignment

**User Story:** As a developer, I want a stable public IP assigned to the FreePBX instance, so that SIP trunk configuration remains consistent across instance restarts.

#### Acceptance Criteria

1. WHEN `terraform apply` is executed, THE Terraform_Module SHALL allocate an Elastic_IP
2. WHEN `terraform apply` is executed, THE Terraform_Module SHALL associate the Elastic_IP with the FreePBX_Instance
3. WHEN the FreePBX_Instance is stopped and restarted, THE Elastic_IP SHALL remain associated with the FreePBX_Instance

### Requirement 5: Security Group for SIP and RTP Traffic

**User Story:** As a developer, I want security group rules that allow SIP and RTP traffic from Retell AI IP ranges, so that the SIP trunk can establish calls between FreePBX and Retell AI.

#### Acceptance Criteria

1. WHEN `terraform apply` is executed, THE Security_Group SHALL allow inbound TCP traffic on ports 5060-5061 from each of the Retell_IP_Ranges
2. WHEN `terraform apply` is executed, THE Security_Group SHALL allow inbound UDP traffic on ports 10000-20000 from each of the Retell_IP_Ranges
3. THE Security_Group SHALL define rules for all four Retell_IP_Ranges: 18.98.16.120/30, 3.42.144.0/23, 143.223.88.0/21, 161.115.160.0/19
4. THE Security_Group SHALL allow all outbound traffic from the FreePBX_Instance

### Requirement 6: Security Group for Administrative Access

**User Story:** As a developer, I want SSH and HTTPS access restricted to my IP address only, so that the FreePBX web admin and SSH are not exposed to the public internet.

#### Acceptance Criteria

1. WHEN `terraform apply` is executed, THE Security_Group SHALL allow inbound TCP traffic on port 443 only from the Admin_IP
2. WHEN `terraform apply` is executed, THE Security_Group SHALL allow inbound TCP traffic on port 22 only from the Admin_IP
3. IF the Admin_IP variable is not provided, THEN THE Terraform_Module SHALL fail validation with a descriptive error message

### Requirement 7: SSH Key Pair Reference

**User Story:** As a developer, I want to specify an existing AWS key pair by name, so that I can SSH into the FreePBX instance using a key I already have.

#### Acceptance Criteria

1. THE Terraform_Module SHALL accept a required variable for the name of an existing AWS key pair
2. THE Terraform_Module SHALL assign the referenced key pair to the FreePBX_Instance at launch
3. IF the specified key pair name does not exist in the AWS account, THEN `terraform apply` SHALL fail with an error from AWS indicating the key pair was not found

### Requirement 8: Terraform Outputs

**User Story:** As a developer, I want Terraform to output the connection details after apply, so that I can immediately access the FreePBX web admin and SSH into the instance.

#### Acceptance Criteria

1. WHEN `terraform apply` completes, THE Terraform_Module SHALL output the value `freepbx_public_ip` containing the Elastic_IP address
2. WHEN `terraform apply` completes, THE Terraform_Module SHALL output the value `freepbx_admin_url` formatted as "https://<Elastic_IP>"
3. WHEN `terraform apply` completes, THE Terraform_Module SHALL output the value `ssh_command` formatted as "ssh admin@<Elastic_IP>" (the developer is expected to have the corresponding private key in their SSH agent or default identity)

### Requirement 9: Deployment Time

**User Story:** As a developer, I want the infrastructure to deploy quickly, so that I can iterate on configuration without long wait times.

#### Acceptance Criteria

1. WHEN `terraform apply` is executed on a clean state, THE Terraform_Module SHALL complete all resource provisioning within 10 minutes

### Requirement 10: Plan Validation

**User Story:** As a developer, I want to validate the Terraform configuration before applying, so that I can catch errors without provisioning resources.

#### Acceptance Criteria

1. WHEN `terraform plan` is executed with valid variable inputs, THE Terraform_Module SHALL produce a plan with no errors
2. WHEN `terraform validate` is executed, THE Terraform_Module SHALL report no configuration errors
