# RECORDS 웹 개발 인수인계

기준일: 2026-08-29

## 현재 구조

| 영역 | 파일 | 현재 책임 |
|---|---|---|
| API·인증 | `src/recordsApi.ts` | token 저장, refresh rotation, API envelope, offline queue |
| 화면 | `src/Prototype.tsx` | 모바일·태블릿 분기, 로그인, 대시보드, 생성·수정, 알림 패널 |
| Web Push 권한 | `src/webPush.ts` | Notification 권한, 표준 PushSubscription 발급·등록 |
| service worker | `public/sw.js`, `index.html` | app shell cache, 표준 background push notification |
| 스타일 | `src/styles.css`, `src/prototype.css` | 반응형 레이아웃과 테마 |

## 현재 동작과 한계

### 인증

로그인 성공 후 access·refresh token을 `localStorage`에 저장한다. access token이 `401`이면 같은 탭의 `refreshInFlight`와 origin 단위 Web Locks API로 refresh rotation을 조정한 뒤 원 요청을 한 번 재시도한다. Web Locks가 없는 Safari 계열은 만료 시간이 있는 localStorage lease로 같은 동작을 보장한다. 실제 invalid refresh일 때만 저장된 token과 offline cache를 지우고 `records:auth-expired`를 발생시킨다.

새로고침·동시 API 요청·여러 탭·offline sync가 refresh rotation과 겹치는 회귀 테스트를 추가했고, 먼저 성공한 새 token을 뒤늦은 요청이 지우지 않도록 처리했다.

### AI 사진 분석

사진을 선택한 뒤 `사진 분석`을 눌러야 `POST /assignment-extractions`를 호출한다. 후보가 여러 개면 사용자가 선택하고, `needsReview` 필드는 주황색으로 강조한다. 날짜가 없는 후보는 날짜 입력을 비워 저장을 막으며 사용자가 직접 확인하게 한다. 사진 분석 실패, 오프라인, 서버의 AI 비활성화는 폼 오류로 표시한다.

### 사진 저장

`downloadCalendarImage()`는 canvas로 월간 달력을 PNG로 만든다. Web Share 파일 공유를 지원하면 iOS·Android 공유 시트를 먼저 열고, 지원하지 않으면 브라우저 다운로드로 저장한다. 과제에 사용한 원본 사진은 서버에 저장하지 않는다.

### 알림

알림 패널은 사용자 전역 마감 전 알림을 10·30·60분 중 선택한다. `브라우저 알림 허용`을 누르면 표준 Web Push subscription을 발급해 `POST /notifications/push-subscriptions`에 등록한다.

플랫폼별 처리:

- Android: HTTPS, service worker, VAPID 공개키, 브라우저 권한이 필요하다.
- iOS: iOS/iPadOS 16.4 이상에서 Safari 공유 → 홈 화면에 추가 → 홈 화면 앱 실행 → 앱 안에서 직접 탭해야 한다. 일반 Safari 탭에서는 권한 팝업이 뜨지 않는다.
- 권한이 `denied`이면 버튼이 다시 팝업을 만들 수 없으므로 설정 앱에서 알림을 허용하도록 안내해야 한다.

생성·수정 폼의 `마감 알림 받기` 토글이 `notificationsEnabled`를 전송한다. 기본값은 `true`이며, 끄면 서버가 해당 과제의 미전달 예약을 제거한다.

## 우선순위 작업

### 1. 로그인·로그아웃 안정화 — 완료

완료 조건:

- 동시 `401`에서 refresh 1회
- 새 refresh token이 이전 요청 때문에 삭제되지 않음
- 실제 refresh 실패 때만 로그인 화면 이동
- 새로고침, 두 탭, offline 복귀 테스트 통과

대상 파일: `src/recordsApi.ts`, `src/Prototype.tsx`.

### 2. Android·iOS 알림 QA — 구현 완료, 실기기 대기

완료 조건:

- 권한 상태 `default/granted/denied/unsupported`가 UI에 구분됨
- iOS non-standalone 화면에 설치 안내가 표시됨
- Android와 iOS 각각 subscription 등록 HTTP `2xx` 확인
- foreground/background에서 중복 알림이 생기지 않음

대상 파일: `src/Prototype.tsx`, `src/webPush.ts`, `public/sw.js`, `index.html`.

### 3. 과제별 알람 토글 — 완료

생성·수정 요청에 다음 field를 추가하는 방향이다.

```json
{"notificationsEnabled": true}
```

UI·API·DB migration을 함께 변경했고, 과제 수정 시 미전달 예약만 재계산한다.

### 4. AI 결과 검토 — 완료

후보 선택, `needsReview` 강조, 빈 날짜 저장 방지를 자동화 테스트로 검증한다. 실제 OpenAI 실호출은 비식별 이미지로만 별도 확인한다.

## 로컬·터널 검증

```bash
npm ci
make frontend-check
```

`frontend-check`는 API mock·로컬 fixture 기반 Playwright만 실행하므로 Spring이나 실 DB가 필요하지 않다. Spring 연동 시나리오를 포함한 전체 Playwright는 백엔드 테스트 환경을 준비한 뒤 `npm run test:runtime`으로 실행한다. 공개 터널 또는 Vercel에서 Web Push를 테스트할 때는 `VITE_API_BASE_URL`이 접근 가능한 HTTPS Spring API URL을 가리켜야 하고, Spring CORS 허용 목록에 프론트 origin이 있어야 한다. 프론트에는 `VITE_VAPID_PUBLIC_KEY`만 두며 VAPID 개인키와 `.env.local`은 커밋하지 않는다.

실기기 확인 순서:

1. 회원가입 → 로그인 → 새로고침 → 과제 목록 유지
2. access token 만료를 재현해 자동 refresh 확인
3. Android Chrome에서 알림 허용 → subscription 등록 → 백그라운드 수신
4. iOS Safari에서 홈 화면 추가 후 앱 실행 → 알림 허용 → 백그라운드 수신
5. 사진 분석은 비식별 이미지로 후보·경고·실패 메시지 확인
6. 캘린더 이미지 저장은 Android 다운로드와 iOS 공유/다운로드를 따로 확인
