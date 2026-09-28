#!/bin/bash
# Claude Code 로그인 (처음 한 번). Max 구독 계정으로 로그인하면 이 프로그램이 추가 요금 없이 Claude 를 씁니다.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund --loglevel=error
echo ""
echo "잠시 뒤 Claude Code 가 열립니다."
echo "1) 로그인 방법을 물으면 'Claude account with subscription'(구독 계정)을 고르세요."
echo "2) 브라우저가 열리면 Max 계정으로 로그인 → 승인하세요."
echo "3) 로그인이 끝나고 입력창이 보이면 /exit 를 입력하고 이 창을 닫으세요."
echo ""
./node_modules/.bin/claude
