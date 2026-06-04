#!/bin/bash
# ── Fata Morgana — Hetzner VPS Setup Script ───────────────────────────────────
# Run this ONCE on a fresh Ubuntu 22.04 server as root.
# Usage:  ssh root@YOUR_SERVER_IP "bash -s" < setup-vps.sh
# Or:     scp setup-vps.sh root@IP:~ && ssh root@IP "bash setup-vps.sh"

set -e
echo "=== Fata Morgana VPS Setup ==="

# ── 1. System update ──────────────────────────────────────────────────────────
apt-get update -y && apt-get upgrade -y

# ── 2. Node.js 20 ─────────────────────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# ── 3. Playwright / Chromium system deps ──────────────────────────────────────
apt-get install -y \
  chromium-browser \
  fonts-liberation libatk-bridge2.0-0 libatk1.0-0 libcups2 \
  libdbus-1-3 libgdk-pixbuf2.0-0 libnspr4 libnss3 \
  libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils

# ── 4. PM2 (keeps server running after reboot) ────────────────────────────────
npm install -g pm2

# ── 5. Clone repo ─────────────────────────────────────────────────────────────
# Change this to your actual GitHub repo URL
REPO="https://github.com/YOUR_USERNAME/fata.git"
git clone "$REPO" /app/fata
cd /app/fata

# ── 6. Install dependencies ───────────────────────────────────────────────────
npm install --ignore-scripts

# ── 7. Playwright — use system Chromium ───────────────────────────────────────
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium-browser || which chromium)
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
echo "Chromium: $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"

# ── 8. Create .env (fill in your credentials) ─────────────────────────────────
cat > /app/fata/.env << 'ENVEOF'
GELATERIA_USER=storoma10
GELATERIA_PASS=crocevia
JWT_SECRET=CHANGE_THIS_TO_A_LONG_RANDOM_STRING_NOW
PORT=3001
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENVEOF

echo "⚠️  Edit /app/fata/.env and set a strong JWT_SECRET before continuing!"

# ── 9. Start server with PM2 ──────────────────────────────────────────────────
cd /app/fata
pm2 start "node server/index.js" --name fata-server
pm2 startup systemd -u root --hp /root
pm2 save

# ── 10. Open firewall port ────────────────────────────────────────────────────
ufw allow 3001/tcp
ufw allow 22/tcp
ufw --force enable

echo ""
echo "✅ Done! Server running on port 3001"
echo "Test: curl http://localhost:3001/health"
echo ""
echo "Your public URL will be: http://YOUR_SERVER_IP:3001"
echo "Update API_BASE in fata-app/lib/api.ts with this URL, then build the APK."
