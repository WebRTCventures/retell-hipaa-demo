#!/bin/bash
set -euo pipefail

# Log all output for troubleshooting
exec > >(tee /var/log/freepbx-install.log) 2>&1

echo "=== FreePBX 17 Installation Starting ==="
echo "Date: $(date)"

# Update system packages
apt-get update && apt-get upgrade -y

# Download and run official Sangoma FreePBX installer
cd /tmp
wget https://github.com/FreePBX/sng_freepbx_debian_install/raw/master/sng_freepbx_debian_install.sh \
  -O /tmp/sng_freepbx_debian_install.sh
bash /tmp/sng_freepbx_debian_install.sh

echo "=== FreePBX 17 Installation Complete ==="
echo "Date: $(date)"
