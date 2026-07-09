terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  required_version = ">= 1.0"
}

provider "aws" {
  region = var.aws_region
}

locals {
  vpc_cidr    = "10.0.0.0/16"
  subnet_cidr = "10.0.1.0/24"

  retell_ip_ranges = [
    "18.98.16.120/30",
    "3.42.144.0/23",
    "143.223.88.0/21",
    "161.115.160.0/19",
  ]

  sip_ports = {
    from_port = 5060
    to_port   = 5061
    protocol  = "tcp"
  }

  sip_ports_udp = {
    from_port = 5060
    to_port   = 5060
    protocol  = "udp"
  }

  rtp_ports = {
    from_port = 10000
    to_port   = 20000
    protocol  = "udp"
  }

  tags = {
    Project   = "retell-hipaa-demo"
    ManagedBy = "terraform"
  }
}

# --- VPC and Networking ---

resource "aws_vpc" "main" {
  cidr_block           = local.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.tags, {
    Name = "freepbx-vpc"
  })
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.subnet_cidr
  map_public_ip_on_launch = true

  tags = merge(local.tags, {
    Name = "freepbx-public-subnet"
  })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.tags, {
    Name = "freepbx-igw"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.tags, {
    Name = "freepbx-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# --- EC2 Instance ---

resource "aws_instance" "freepbx" {
  ami                    = data.aws_ami.debian12.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.freepbx.id]
  key_name               = var.key_pair_name
  user_data              = file("${path.module}/user_data.sh")

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  tags = merge(local.tags, {
    Name = "freepbx-instance"
  })
}

# --- Elastic IP ---

resource "aws_eip" "freepbx" {
  domain = "vpc"

  tags = merge(local.tags, {
    Name = "freepbx-eip"
  })
}

resource "aws_eip_association" "freepbx" {
  instance_id   = aws_instance.freepbx.id
  allocation_id = aws_eip.freepbx.id
}
