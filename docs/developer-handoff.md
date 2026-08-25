# RECORDS 웹 개발 인수인계

기준일: 2026-08-25

## 현재 구조

| 영역 | 파일 | 현재 책임 |
|---|---|---|
| API·인증 | `src/recordsApi.ts` | token 저장, refresh rotation, API envelope, offline queue |
| 화면 | `src/Prototype.tsx` | 모바일·태블릿 분기, 로그인, 대시보드, 생성·수정, 알림 패널 |
| Firebase 권한 | `src/firebaseMessaging.ts` | Notification 권한, FCM token 발급, foreground message |
| service worker | `public/sw.js`, `index.html` | app shell cache, background FCM notification |
| 스타일 | `src/styles.css`, `src/prototype.css` | 반응형 레이아웃과 테마 |

## 현재 동작과 한계

### 인증

로그인 성공 후 access·refresh token을 `localStorage`에 저장한다. access token이 `401`이면 `refreshInFlight`로 refresh 요청을 합친 뒤 원 요청을 한 번 재시도한다. refresh가 실패하면 저장된 token과 offline cache를 모두 지우고 `records:auth-expired`를 발생시킨다.

현재 문제는 새로고침·동시 API 요청·여러 탭·offline sync가 refresh rotation과 겹칠 때 로그아웃이 발생하는 것이다. 다음 작업은 token 값이 아니라 요청 순서와 refresh 결과를 기록하는 재현 테스트부터 시작한다.

### AI 사진 분석

`PhotoPicker`가 선택한 파일을 `POST /assignment-extractions`로 전송한다. 웹은 응답의 `candidates[0]`만 폼에 채운다. 사진 분석 실패, 오프라인, 서버의 AI 비활성화는 폼 오류로 표시한다.

다음 작업:

- 후보가 여러 개면 선택할 수 있게 한다.
- `needsReview`를 필드별 경고로 보여준다.
- 날짜가 없는 후보도 제목·과목을 유지하고 날짜는 직접 입력하게 한다.
- 실제 이미지는 비식별 fixture로만 테스트한다.

### 사진 저장

`downloadCalendarImage()`는 canvas로 월간 달력을 PNG로 만들어 브라우저 다운로드한다. 캘린더 이미지 저장은 로컬 구현이며, iOS 사진 앱에 직접 저장하는 기능은 아니다. 과제에 사용한 원본 사진은 서버에 저장하지 않는다.

요구사항이 캘린더 배경화면이면 `navigator.share({ files })` 지원 여부를 확인하고 다운로드 fallback을 유지한다. 원본 사진 보관이면 백엔드 저장소·권한·삭제 정책을 먼저 확정해야 한다.

### 알림

알림 패널은 사용자 전역 마감 전 알림을 10·30·60분 중 선택한다. `브라우저 알림 허용`을 누르면 Firebase Web Push token을 발급해 `POST /notifications/push-tokens`에 등록한다.

플랫폼별 처리:

- Android: HTTPS, service worker, Firebase Web 설정, 브라우저 권한이 필요하다.
- iOS: iOS/iPadOS 16.4 이상에서 Safari 공유 → 홈 화면에 추가 → 홈 화면 앱 실행 → 앱 안에서 직접 탭해야 한다. 일반 Safari 탭에서는 권한 팝업이 뜨지 않는다.
- 권한이 `denied`이면 버튼이 다시 팝업을 만들 수 없으므로 설정 앱에서 알림을 허용하도록 안내해야 한다.

현재 생성·수정 폼에는 과제별 알람 버튼이 없다. 백엔드도 사용자 전역 설정만 저장한다. 과제별 토글을 추가할 때는 `notificationsEnabled`의 기본값, 기존 데이터 migration, 예약 취소·재생성 규칙을 함께 정한다.

## 우선순위 작업

### 1. 로그인·로그아웃 안정화

완료 조건:

- 동시 `401`에서 refresh 1회
- 새 refresh token이 이전 요청 때문에 삭제되지 않음
- 실제 refresh 실패 때만 로그인 화면 이동
- 새로고침, 두 탭, offline 복귀 테스트 통과

대상 파일: `src/recordsApi.ts`, `src/Prototype.tsx`.

### 2. Android·iOS 알림 QA

완료 조건:

- 권한 상태 `default/granted/denied/unsupported`가 UI에 구분됨
- iOS non-standalone 화면에 설치 안내가 표시됨
- Android와 iOS 각각 token 등록 HTTP `2xx` 확인
- foreground/background에서 중복 알림이 생기지 않음

대상 파일: `src/Prototype.tsx`, `src/firebaseMessaging.ts`, `public/sw.js`, `index.html`.

### 3. 과제별 알람 토글

생성·수정 요청에 다음 field를 추가하는 방향이다.

```json
{"notificationsEnabled": true}
```

UI 토글과 API field를 동시에 변경하고, 과제 수정 시 미전달 예약만 재계산한다. 서버 계약이 먼저 확정되기 전에는 프론트만 임의로 저장하지 않는다.

### 4. AI 결과 검토

후보 선택 화면을 추가하고, 후보의 `needsReview`에 포함된 입력을 강조한다. 모델이 날짜를 추측하지 않도록 빈 날짜도 정상 상태로 처리한다.

## 로컬·터널 검증

```bash
npm install
npm run check:runtime
npx tsc --noEmit
npm run build
```

공개 터널에서 Firebase Web Push를 테스트할 때는 `VITE_API_BASE_URL`이 같은 터널의 API URL을 가리켜야 하고, 서버 CORS 허용 목록에 프론트 origin이 있어야 한다. `.env.local`과 Firebase service account는 커밋하지 않는다.

실기기 확인 순서:

1. 회원가입 → 로그인 → 새로고침 → 과제 목록 유지
2. access token 만료를 재현해 자동 refresh 확인
3. Android Chrome에서 알림 허용 → token 등록 → 백그라운드 수신
4. iOS Safari에서 홈 화면 추가 후 앱 실행 → 알림 허용 → 백그라운드 수신
5. 사진 분석은 비식별 이미지로 후보·경고·실패 메시지 확인
6. 캘린더 이미지 저장은 Android 다운로드와 iOS 공유/다운로드를 따로 확인
