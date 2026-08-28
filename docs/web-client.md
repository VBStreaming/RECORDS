# 웹 클라이언트 개발 계약

## 범위

`web/`은 기존 RECORDS 프로토타입을 반응형 웹으로 옮긴 Vite·React·TypeScript 클라이언트다.

현재 포함 범위:

- 이메일·비밀번호 회원가입과 로그인
- 대시보드와 월간 과제 조회
- 과제 직접 생성과 완료/완료 취소
- 사진 선택·미리보기
- 사용자가 명시적으로 요청한 사진 자동 추출 결과를 수정한 뒤 과제 저장
- 데스크톱과 모바일 레이아웃, 라이트·다크 테마

소셜 로그인은 현재 범위가 아니다. 과제 수정·삭제, 오프라인 동기화, refresh token rotation을 포함한다.

## 로컬 실행

먼저 API와 PostgreSQL을 실행한다.

```bash
make venv
make db-up
make migrate
make dev
```

다른 터미널에서 웹을 실행한다.

```bash
make web-install
make web-dev
```

- 웹: <http://127.0.0.1:5173>
- API 문서: <http://127.0.0.1:8000/docs>

Vite 개발 서버는 `/api` 요청을 `http://127.0.0.1:8000`으로 전달한다. 배포 시 같은 origin에서 API를 중계하지 않는다면 `VITE_API_BASE_URL`에 공개 API URL을 빌드 환경변수로 설정하고, FastAPI에는 정확한 웹 origin만 허용하는 CORS 설정을 별도 추가한다.

## API 연결 원칙

- 성공·오류 응답은 `docs/api-response.md`의 envelope를 해석한다.
- access token과 refresh token은 `localStorage`에 저장한다. access token이 만료되면 refresh token rotation 후 원래 요청을 한 번 재시도한다.
- 인증된 사용자 ID는 token에서만 결정하며 웹 요청에 `user_id`를 넣지 않는다.
- 사진 선택만으로 OpenAI API를 호출하지 않는다. `사진에서 과제 찾기` 버튼을 눌렀을 때만 `POST /assignment-extractions`를 호출한다.
- 추출 결과는 자동 저장하지 않는다. 사용자가 제목·과목·마감일을 확인한 뒤 기존 `POST /assignments`로 저장한다.

## 검증

```bash
make web-check
```

`web-check`는 TypeScript 검사와 production build를 실행한다. API 연결을 바꾼 경우에는 브라우저에서 회원가입 → 로그인 → 과제 생성 → 완료 처리 흐름도 확인한다. OpenAI 실호출은 비용과 개인정보 전송이 발생하므로 명시적인 PoC에서만 수행한다.

## Web Push와 Vercel 배포

알림은 Firebase SDK가 아니라 브라우저 표준 Web Push와 VAPID를 사용한다. `VITE_VAPID_PUBLIC_KEY`만 프론트에 넣고, VAPID 개인키는 Spring 서버 환경변수에만 둔다. iOS/iPadOS는 HTTPS와 홈 화면에 추가한 standalone 웹앱, 직접 탭 권한 요청이 필요하다.

이 Vite 프로젝트는 별도 Vercel adapter 없이 다음 기본값으로 배포할 수 있다.

- Build command: `npm run build`
- Output directory: `dist/client`
- Environment variables: `VITE_API_BASE_URL`, `VITE_VAPID_PUBLIC_KEY`

`VITE_API_BASE_URL`은 Vercel에서 접근 가능한 HTTPS API origin이어야 하고, Spring `CORS_ALLOWED_ORIGINS`에 Vercel 배포 origin을 추가해야 한다. Vercel Hobby는 개인·비상업 용도 기준의 무료 플랜이며, Vercel이 배포 origin에 HTTPS 인증서를 제공한다. API 서버와 DB는 별도로 계속 운영한다.
