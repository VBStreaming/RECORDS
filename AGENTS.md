# RECORDS Development Agent Guide

이 파일은 저장소 전체에 적용된다. 문서와 코드가 다르면 현재 코드와 테스트를 실행 사실의 기준으로 삼는다.

## 현재 구조

- 이 저장소의 현재 프론트엔드는 프로젝트 루트의 Vite·React·TypeScript 앱이다. 진입점은 `index.html`과 `src/`이며 `web/`은 사용하지 않는다.
- 현재 백엔드는 별도 `records-server` 저장소의 Spring Boot 애플리케이션이다. 이 저장소의 `app/`, Alembic, Python 테스트와 FastAPI 문서는 레거시이므로 별도 정리 작업이 아니면 현행 개발 기준으로 사용하지 않는다.
- 프론트엔드는 `VITE_API_BASE_URL`의 Spring API를 호출한다. 미설정 시 현재 hostname의 `8001` 포트를 사용한다.
- Vercel은 루트 `vercel.json`에 고정된 `npm run build`와 `dist/client`를 사용한다.

## 작업 전 읽을 문서

- 웹 구조와 배포: [`docs/web-client.md`](docs/web-client.md)
- 현재 구현과 한계: [`docs/developer-handoff.md`](docs/developer-handoff.md)
- 로컬 환경변수 예시: [`.env.example`](.env.example)

Spring API 계약이나 백엔드 코드를 변경할 때는 `records-server` 저장소의 `AGENTS.md`와 테스트를 따른다.

## 프론트엔드 명령

```bash
make frontend-install
make frontend-dev
make frontend-check
```

`frontend-check`는 보호된 모바일 runtime 무결성, TypeScript, production build와 API mock·로컬 fixture 기반 Playwright를 검사한다. Spring 연동 시나리오는 제외하므로 실 DB가 필요하지 않다. 전체 Playwright는 백엔드 테스트 환경을 준비한 뒤 `npm run test:runtime`으로 실행한다.

## 코드와 배포 규칙

- 새 dependency나 abstraction은 실제 필요가 생기기 전까지 추가하지 않는다.
- access token과 refresh token, 요청 body, API key와 private key를 로그에 남기지 않는다.
- 프론트에는 `VITE_VAPID_PUBLIC_KEY`만 둔다. VAPID private key와 Spring secret은 Vercel에 넣지 않는다.
- `VITE_API_BASE_URL`은 배포된 HTTPS Spring API origin으로 설정하고, Spring CORS에는 실제 Vercel origin만 허용한다.
- `.env.local`, credential, 원본 이미지와 개인정보 fixture를 커밋하지 않는다.
- 현재 runtime 보호 파일을 변경할 때는 변경 이유를 확인하고 `npm run update:runtime-lock`을 별도 검토한다.

## 검증과 Git 규칙

- 프론트엔드 또는 배포 설정 변경 후 `make frontend-check`와 `git diff --check`를 실행한다.
- Conventional Commit 형식을 사용하고 의도한 파일만 stage한다. `git add .`와 `git add -A`를 사용하지 않는다.
- 사용자 요청 없이 commit, push, rebase, squash, force-push를 하지 않는다.
- 다른 작업자의 변경을 되돌리거나 무관한 파일을 정리하지 않는다.
