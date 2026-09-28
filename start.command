#!/bin/bash
# 더블클릭하면: 최신 버전으로 자동 업데이트 → 실행 → 브라우저 열기
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치하세요."; read -r; exit 1; }

if [ -d .git ]; then
  echo "최신 버전 확인 중…"
  git pull --ff-only -q && echo "최신 버전입니다." || echo "업데이트를 못 받았습니다. 지금 버전으로 실행합니다."
fi
npm install --no-audit --no-fund --loglevel=error
[ -f .env ] || cp .env.example .env

(sleep 2; open http://localhost:4173) &
echo ""
echo "이 창을 닫으면 프로그램이 꺼집니다."
npm start
