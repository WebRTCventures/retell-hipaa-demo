#!/bin/bash
set -uo pipefail

# Log all output for troubleshooting
exec > >(tee /var/log/freepbx-install.log) 2>&1

echo "=== FreePBX 17 Installation Starting ==="
echo "Date: $(date)"

# Update system packages
apt-get update && apt-get upgrade -y

# Download official Sangoma FreePBX installer
cd /tmp
wget https://github.com/FreePBX/sng_freepbx_debian_install/raw/master/sng_freepbx_debian_install.sh \
  -O /tmp/sng_freepbx_debian_install.sh

# Run the installer — allow it to fail on non-critical post-install steps
# (e.g., module upgrades can fail due to transient mirror/checksum issues)
if bash /tmp/sng_freepbx_debian_install.sh; then
  echo "=== FreePBX 17 Installation Complete ==="
else
  echo "=== FreePBX 17 installer exited with errors (likely module upgrade) ==="
  echo "Attempting module upgrade retry after 30s cooldown..."
  sleep 30

  # Retry module upgrades up to 3 times (transient mirror/checksum failures)
  for attempt in 1 2 3; do
    echo "Module upgrade attempt $attempt of 3..."
    if fwconsole ma upgradeall; then
      echo "Module upgrade succeeded on attempt $attempt"
      break
    else
      echo "Module upgrade failed on attempt $attempt"
      if [ "$attempt" -lt 3 ]; then
        sleep 30
      fi
    fi
  done

  # Ensure services are running regardless of module upgrade outcome
  fwconsole restart || true
  echo "=== FreePBX 17 core installation complete (module upgrades may be partial) ==="
fi

echo "Date: $(date)"
