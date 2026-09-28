#!/bin/bash
# Claude 구독(Max) 로그인. 보통은 프로그램 화면의 "Claude 로그인" 버튼을 쓰면 되고, 이 파일은 예비용입니다.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund --loglevel=error
echo ""
echo "브라우저가 열리면 Max 계정으로 로그인 → 승인(Authorize)을 누르세요."
echo "화면에 코드가 나오면 복사해서 여기에 붙여넣고 엔터를 누르세요."
echo ""
./node_modules/.bin/claude auth login --claudeai
echo ""
./node_modules/.bin/claude auth status --text
echo ""
echo "이 창을 닫아도 됩니다."
read -r
