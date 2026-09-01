# 웹 클라이언트 개발 계약

## 범위

프로젝트 루트는 RECORDS의 Vite·React·TypeScript 클라이언트다. `index.html`, `src/`, `public/`과 루트 `package.json`을 사용하며 레거시 `web/` 하위 앱은 사용하지 않는다.

현재 포함 범위:

- 이메일·비밀번호 회원가입·인증·로그인과 비밀번호 재설정
- 대시보드와 월간 과제 조회
- 과제 직접 생성과 완료/완료 취소
- 사진 선택 후 명시적인 AI 분석과 후보 검토
- 사용자가 명시적으로 요청한 사진 자동 추출 결과를 수정한 뒤 과제 저장
- 데스크톱과 모바일 레이아웃, 라이트·다크 테마

소셜 로그인은 현재 범위가 아니다. 과제 수정·삭제, 오프라인 동기화, refresh token rotation을 포함한다.

## 로컬 실행

별도 `records-server` 저장소에서 Spring Boot API를 `8001` 포트로 실행한다. 이 저장소에서는 루트 React 앱을 실행한다.

```bash
make frontend-install
make frontend-dev
```

- 웹: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:8001>

`VITE_API_BASE_URL`을 설정하지 않으면 웹은 현재 hostname의 `8001` 포트를 사용한다. 배포 시에는 공개 Spring API의 HTTPS origin을 `VITE_API_BASE_URL`에 설정하고, Spring CORS에는 정확한 웹 origin만 허용한다.

## API 연결 원칙

- 성공·오류 응답은 `docs/api-response.md`의 envelope를 해석한다.
- 신규 가입과 미인증 로그인은 별도 `/check-email` 화면으로 이동해 이메일로 받은 5자리 코드를 확인한다. 확인 성공 시 발급된 로그인 토큰을 저장하고 완료 화면에서 바로 서비스로 진입한다. `/reset-password`는 메일의 token query를 Spring API에 전달한다.
- 로그인 화면의 비밀번호 찾기는 `/forgot-password`에서 계정 존재 여부를 노출하지 않는 공통 완료 문구를 사용한다.
- access token과 refresh token은 `localStorage`에 저장한다. access token이 만료되면 refresh token rotation 후 원래 요청을 한 번 재시도한다.
- 인증된 사용자 ID는 token에서만 결정하며 웹 요청에 `user_id`를 넣지 않는다.
- 사진 선택만으로 OpenAI API를 호출하지 않는다. `사진 분석` 버튼을 눌렀을 때만 `POST /assignment-extractions`를 호출한다.
- 추출 결과는 자동 저장하지 않는다. 사용자가 제목·과목·마감일을 확인한 뒤 기존 `POST /assignments`로 저장한다.
- 생성·수정의 `마감 알림 받기` 토글은 `notificationsEnabled`로 전송한다.
- 캘린더 PNG는 공유창을 열지 않고 브라우저 다운로드로 기기에 저장한다.

## 검증

```bash
make frontend-check
```

`frontend-check`는 `check:runtime`, TypeScript, production build와 API mock·로컬 fixture 기반 Playwright를 실행한다. Spring 연동이 필요한 가입·알림 설정·offline sync 시나리오는 CI에서 제외하므로 실 DB를 시작하지 않는다. 전체 Playwright는 백엔드 테스트 환경을 준비한 뒤 `npm run test:runtime`으로 실행한다. OpenAI 실호출은 비용과 개인정보 전송이 발생하므로 명시적인 PoC에서만 수행한다.

## Web Push와 Vercel 배포

알림은 Firebase SDK가 아니라 브라우저 표준 Web Push와 VAPID를 사용한다. `VITE_VAPID_PUBLIC_KEY`만 프론트에 넣고, VAPID 개인키는 Spring 서버 환경변수에만 둔다. iOS/iPadOS는 HTTPS와 홈 화면에 추가한 standalone 웹앱, 직접 탭 권한 요청이 필요하다.

루트 `vercel.json`이 다음 값을 고정한다.

- Build command: `npm run build`
- Output directory: `dist/client`
- Environment variables: `VITE_API_BASE_URL`, `VITE_VAPID_PUBLIC_KEY`
- Rewrites: `/check-email`, `/forgot-password`, `/reset-password` → `index.html`

`VITE_API_BASE_URL`은 Vercel에서 접근 가능한 HTTPS API origin이어야 하고, Spring `CORS_ALLOWED_ORIGINS`에 Vercel 배포 origin을 추가해야 한다. API 서버와 DB는 Vercel 프론트엔드와 별도로 운영한다. 배포 전에도 CI와 같은 `make frontend-check`를 통과시킨다.
