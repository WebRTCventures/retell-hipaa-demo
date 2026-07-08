# Security group for FreePBX instance
# Allows SIP/RTP from Retell AI IP ranges and admin access from a single IP

resource "aws_security_group" "freepbx" {
  name        = "freepbx-sg"
  description = "Security group for FreePBX instance - SIP/RTP from Retell AI, admin access restricted"
  vpc_id      = aws_vpc.main.id

  tags = merge(local.tags, {
    Name = "freepbx-sg"
  })
}

# SIP ingress rules - one per Retell IP range
resource "aws_security_group_rule" "sip_ingress" {
  for_each = toset(local.retell_ip_ranges)

  type              = "ingress"
  description       = "SIP signaling from Retell AI (${each.value})"
  from_port         = local.sip_ports.from_port
  to_port           = local.sip_ports.to_port
  protocol          = local.sip_ports.protocol
  cidr_blocks       = [each.value]
  security_group_id = aws_security_group.freepbx.id
}

# RTP ingress rules - one per Retell IP range
resource "aws_security_group_rule" "rtp_ingress" {
  for_each = toset(local.retell_ip_ranges)

  type              = "ingress"
  description       = "RTP media/audio from Retell AI (${each.value})"
  from_port         = local.rtp_ports.from_port
  to_port           = local.rtp_ports.to_port
  protocol          = local.rtp_ports.protocol
  cidr_blocks       = [each.value]
  security_group_id = aws_security_group.freepbx.id
}

# HTTPS ingress from admin IP - FreePBX web UI
resource "aws_security_group_rule" "https_ingress" {
  type              = "ingress"
  description       = "HTTPS access to FreePBX web admin"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = [var.admin_ip]
  security_group_id = aws_security_group.freepbx.id
}

# SSH ingress from admin IP - instance access
resource "aws_security_group_rule" "ssh_ingress" {
  type              = "ingress"
  description       = "SSH access to FreePBX instance"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = [var.admin_ip]
  security_group_id = aws_security_group.freepbx.id
}

# Egress - allow all outbound traffic
resource "aws_security_group_rule" "all_egress" {
  type              = "egress"
  description       = "Allow all outbound traffic"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.freepbx.id
}
