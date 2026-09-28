#!/bin/bash
# 더블클릭하면: 최신 버전으로 자동 업데이트 → 실행 → 브라우저 열기
cd "$(dirname "$0")" || { echo "프로그램 폴더를 열 수 없습니다. 시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더 → 터미널에서 접근을 허용하세요."; read -r; exit 1; }
echo "프로그램 폴더: $(pwd)"

# 이미 켜져 있으면 (예전 버전일 수 있으니) 끄고 새로 켠다
OLD_PID=$(lsof -nP -tiTCP:4173 -sTCP:LISTEN 2>/dev/null)
if [ -n "$OLD_PID" ]; then
  echo "켜져 있던 프로그램을 끄고 최신 버전으로 다시 켭니다."
  kill $OLD_PID 2>/dev/null; sleep 1
fi
command -v node >/dev/null || { echo "Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치하세요."; read -r; exit 1; }

if [ -d .git ]; then
  echo "최신 버전 확인 중…"
  # 설치 과정에서 바뀐 파일(package-lock 등) 때문에 업데이트가 막히지 않도록 서버 버전으로 맞춘다.
  # (.env 와 data 폴더는 git 이 관리하지 않으므로 그대로 남는다)
  if git fetch -q origin && git reset -q --hard '@{u}'; then
    echo "최신 버전입니다: $(git log -1 --format='%cd %s' --date=format:'%m/%d %H:%M')"
  else
    echo "업데이트를 못 받았습니다(인터넷 확인). 지금 버전으로 실행합니다."
  fi
fi
npm install --no-audit --no-fund --loglevel=error
[ -f .env ] || cp .env.example .env

(sleep 2; open http://localhost:4173) &
echo ""
echo "이 창을 닫으면 프로그램이 꺼집니다."
npm start
