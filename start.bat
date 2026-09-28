@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo [!] Node.js 가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치하세요. & pause & exit /b)
if not exist node_modules (echo 처음 실행: 필요한 부품을 설치합니다... & call npm install)
if not exist .env (copy .env.example .env >nul & echo [!] .env 파일을 만들었습니다. 메모장으로 열어 ANTHROPIC_API_KEY 를 넣은 뒤 다시 실행하세요. & notepad .env & exit /b)
start "" http://localhost:4173
call npm start
pause
