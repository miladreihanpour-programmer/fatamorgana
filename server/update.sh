#!/bin/bash
# Run on the VPS to pull latest code and restart server
# Usage: ssh root@IP "bash /app/fata/server/update.sh"
cd /app/fata
git pull
npm install --ignore-scripts
pm2 restart fata-server
echo "✅ Server updated and restarted"
