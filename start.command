#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치하세요."; read -r; exit 1; }
[ -d node_modules ] || npm install
if [ ! -f .env ]; then cp .env.example .env; echo ".env 파일을 만들었습니다. ANTHROPIC_API_KEY 를 넣은 뒤 다시 실행하세요."; open -e .env; exit 0; fi
(sleep 2; open http://localhost:4173) &
npm start
