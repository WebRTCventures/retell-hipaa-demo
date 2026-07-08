output "freepbx_public_ip" {
  description = "The stable public IP address assigned to the FreePBX instance"
  value       = aws_eip.freepbx.public_ip
}

output "freepbx_admin_url" {
  description = "URL to access the FreePBX web administration interface"
  value       = "https://${aws_eip.freepbx.public_ip}"
}

output "ssh_command" {
  description = "SSH command to connect to the FreePBX instance"
  value       = "ssh admin@${aws_eip.freepbx.public_ip}"
}
