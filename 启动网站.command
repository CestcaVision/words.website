#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
command -v node >/dev/null || { echo '请安装 Node.js 24 LTS: https://nodejs.org/'; exit 1; }
node scripts/launcher.mjs start
