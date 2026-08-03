# 과제(Assignment) 구현 계약

상태: **구현 예정**

이 문서는 검증 MVP에서 인증 사용자별 과제를 저장하고 조회하는 백엔드 계약이다. 구현 순서는 [`implementation-roadmap.md`](implementation-roadmap.md)의 TASK-003~007을 따른다.

## 범위

포함:

- 과제 생성, 날짜 범위 목록, 상세 조회
- 과제명·과목·마감 일시 수정
- 완료와 완료 취소
- 과제 삭제
- 진행 중 개수와 가장 가까운 미완료 과제
- Asia/Seoul 날짜 기준 D-Day 계산
- 모든 과제 endpoint의 사용자별 객체 권한

제외:

- 첨부 사진과 이미지 저장소
- 푸시 알림 일정
- 반복 과제, 공유, 사용자 정의 과목
- pagination, 검색, 정렬 옵션

## 데이터 모델

`assignments` table은 다음 column만 가진다.

| Column | Type | 제약과 의미 |
|---|---|---|
| `id` | UUID | Primary key, 애플리케이션에서 UUID4 생성 |
| `user_id` | UUID | `users.id` 외래 키, 필수, 사용자 삭제 시 cascade |
| `title` | VARCHAR(100) | trim 후 1~100자 |
| `subject` | VARCHAR(20) | 아래 subject code 중 하나 |
| `due_at` | TIMESTAMPTZ | 필수, UTC 저장 |
| `completed_at` | TIMESTAMPTZ | 미완료면 `NULL`, 완료 시 최초 완료 UTC 시각 |
| `created_at` | TIMESTAMPTZ | 필수, DB 현재 시각 |
| `updated_at` | TIMESTAMPTZ | 필수, 생성 및 마지막 변경 시각 |

index는 `(user_id, due_at)` 하나만 둔다. 검증 MVP에서는 사용자별 데이터가 작고 모든 조회가 `user_id`를 포함하므로 추가 index나 별도 집계 table을 만들지 않는다.

완료 여부는 `completed_at IS NOT NULL`에서 계산한다. 별도 `status` column과 soft delete column은 두지 않는다. 과제 삭제는 현재 자식 파일이 없으므로 hard delete다.

## 과목 코드

클라이언트 표시 문구와 무관하게 API와 DB는 아래 안정적인 code를 사용한다.

| Code | 표시 예시 |
|---|---|
| `KOREAN` | 국어 |
| `ENGLISH` | 영어 |
| `MATH` | 수학 |
| `SOCIAL_STUDIES` | 사회 |
| `SCIENCE` | 과학 |
| `HISTORY` | 역사 |
| `ETC` | 기타 |

사용자 정의 문자열은 받지 않는다. code 목록 변경은 migration이 필요한 API 계약 변경으로 취급한다.

## 시간과 D-Day 규칙

- 요청의 `dueAt`은 UTC offset을 포함한 ISO 8601 timestamp여야 한다. offset 없는 시각은 `422`로 거절한다.
- DB에는 UTC로 변환해 저장하고 API timestamp 응답도 UTC의 `Z` 형식으로 반환한다.
- D-Day는 시각 차이가 아니라 `Asia/Seoul`의 달력 날짜 차이로 계산한다.
- `dayOffset = 마감일의 한국 날짜 - 현재 한국 날짜`다.
- `dayOffset > 0`이면 `D-{dayOffset}`, `0`이면 `D-Day`, 음수면 `{abs(dayOffset)}일 지남`이다.
- 같은 날짜에 마감 시각이 지났더라도 다음 자정 전까지 `D-Day`다.
- 계산 결과는 저장하지 않고 응답할 때 계산한다.

테스트는 현재 시각을 주입하거나 고정해 자정과 월·연도 경계에서 재현 가능해야 한다. 전역 시스템 시각을 직접 바꾸지 않는다.

## 공통 과제 응답

```json
{
  "id": "6b6e46da-65db-4b06-acbc-ecf4283fb03d",
  "title": "수학 프린트 3장",
  "subject": "MATH",
  "dueAt": "2026-08-08T14:00:00Z",
  "completed": false,
  "completedAt": null,
  "dayOffset": 4,
  "deadlineLabel": "D-4",
  "createdAt": "2026-08-04T04:00:00Z",
  "updatedAt": "2026-08-04T04:00:00Z"
}
```

`userId`는 응답하지 않는다. 클라이언트는 현재 로그인 사용자의 데이터라는 전제만 사용한다.

## API 계약

모든 endpoint는 `Authorization: Bearer <access-token>`이 필요하다. token이 없거나 유효하지 않으면 기존 인증 계약의 `401 INVALID_TOKEN`을 반환한다.

### `POST /assignments`

요청:

```json
{
  "title": " 수학 프린트 3장 ",
  "subject": "MATH",
  "dueAt": "2026-08-08T23:00:00+09:00"
}
```

검증:

- `title`: trim 후 1~100자
- `subject`: 정의된 code 중 하나
- `dueAt`: offset이 있는 유효한 timestamp
- 과거 마감일도 기록을 위해 허용
- `userId`, `completed`, `completedAt`은 요청으로 받지 않음

성공: `201 Created`와 공통 과제 응답.

### `GET /assignments`

요청 예:

```text
GET /assignments?from=2026-08-01&to=2026-08-31&completed=false
```

query 계약:

- `from`, `to`: `Asia/Seoul` 달력 날짜이며 둘 다 필수
- 양 끝 날짜를 모두 포함
- `from <= to`여야 함
- 최대 범위는 62일
- `completed`: 선택 사항. `true`, `false`, 미지정 중 하나

DB 조회 범위는 `from`의 한국 자정 이상, `to + 1일`의 한국 자정 미만을 UTC로 변환해 적용한다. 응답은 공통 과제 응답의 JSON 배열이다.

정렬:

1. 미완료 과제 먼저
2. 미완료 과제는 `dueAt` 오름차순
3. 완료 과제는 `completedAt` 내림차순
4. 같은 값이면 `id` 오름차순으로 결과를 고정

pagination은 제공하지 않는다. 최대 62일 제한이 실제 사용에서 부족하다는 근거가 생기면 cursor pagination을 추가한다.

### `GET /assignments/{assignment_id}`

성공: `200 OK`와 공통 과제 응답.

조회는 다음 조건을 한 query에 적용한다.

```text
assignment.id = path assignment_id
AND assignment.user_id = token의 현재 사용자 id
```

식별자가 없거나 다른 사용자 소유이면 모두 `404 ASSIGNMENT_NOT_FOUND`를 반환한다. 소유 여부를 구분하는 `403`은 사용하지 않는다.

### `PATCH /assignments/{assignment_id}`

요청 예:

```json
{
  "title": "수학 프린트 4장",
  "dueAt": "2026-08-09T23:00:00+09:00"
}
```

규칙:

- `title`, `subject`, `dueAt`만 선택적으로 받는다.
- 적어도 한 필드는 있어야 한다.
- 전달한 필드의 `null`은 허용하지 않는다.
- 생성 API와 같은 필드 검증을 사용한다.
- 성공한 실제 변경은 `updatedAt`을 갱신한다.
- 완료 상태는 이 endpoint에서 바꾸지 않는다.

성공: `200 OK`와 변경된 공통 과제 응답.

권한과 미존재 오류는 상세 조회와 같다.

### `PUT /assignments/{assignment_id}/completion`

요청:

```json
{
  "completed": true
}
```

규칙:

- `false → true`: 현재 UTC 시각을 `completed_at`에 기록한다.
- 이미 완료된 과제에 `true`: 기존 `completed_at`을 보존한다.
- `true → false`: `completed_at`을 `NULL`로 변경한다.
- 이미 미완료인 과제에 `false`: 상태를 그대로 유지한다.
- 상태가 실제 변경될 때만 `updatedAt`을 갱신한다.

성공: `200 OK`와 공통 과제 응답. 같은 요청을 반복해도 같은 상태가 되는 멱등 endpoint다.

### `DELETE /assignments/{assignment_id}`

성공: body 없는 `204 No Content`.

삭제 후 같은 식별자를 다시 조회하거나 삭제하면 `404 ASSIGNMENT_NOT_FOUND`를 반환한다. 권한과 미존재 오류는 상세 조회와 같다.

### `GET /dashboard`

성공 예:

```json
{
  "activeCount": 3,
  "nearestAssignment": {
    "id": "6b6e46da-65db-4b06-acbc-ecf4283fb03d",
    "title": "수학 프린트 3장",
    "subject": "MATH",
    "dueAt": "2026-08-08T14:00:00Z",
    "completed": false,
    "completedAt": null,
    "dayOffset": 4,
    "deadlineLabel": "D-4",
    "createdAt": "2026-08-04T04:00:00Z",
    "updatedAt": "2026-08-04T04:00:00Z"
  }
}
```

규칙:

- `activeCount`: 현재 사용자의 `completed_at IS NULL`인 전체 과제 수. 기한이 지난 미완료도 포함한다.
- `nearestAssignment`: 미완료 중 기한이 지난 과제가 있으면 가장 최근에 지난 과제, 없으면 가장 이른 예정 과제.
- 과제가 없거나 모두 완료됐다면 `activeCount`는 `0`, `nearestAssignment`는 `null`.
- 다른 사용자의 과제는 count와 대표 과제 query 모두에서 제외한다.

## 오류 형식

애플리케이션이 직접 발생시키는 오류는 인증 API와 같은 형식을 사용한다.

```json
{
  "detail": {
    "code": "ASSIGNMENT_NOT_FOUND",
    "message": "과제를 찾을 수 없습니다."
  }
}
```

| 상태 | Code | 사용 조건 |
|---|---|---|
| `401` | `INVALID_TOKEN` | token 없음, 위조, 만료, 사용자가 없음 |
| `404` | `ASSIGNMENT_NOT_FOUND` | 과제가 없거나 현재 사용자 소유가 아님 |
| `422` | FastAPI 기본 검증 오류 | body, query, path 형식 또는 범위 오류 |

예상 가능한 사용자 입력 오류를 `500`으로 반환하지 않는다. DB 내부 오류, SQL, JWT, 전체 요청 body는 로그에 남기지 않는다.

## 객체 권한 규칙

- 사용자 ID는 JWT의 `sub`에서만 얻는다.
- 과제 상세·수정·완료·삭제 query에는 `assignment.id`와 `assignment.user_id`를 동시에 포함한다.
- 먼저 ID로 조회한 뒤 Python에서 소유권을 비교하지 않는다.
- 목록·대시보드 query는 항상 현재 사용자 ID로 시작한다.
- 타 사용자 소유 여부를 드러내지 않도록 `404`를 사용한다.

## 구현 파일 경계

기본 변경 파일은 다음과 같다.

- `app/models.py`: `Assignment` model
- `app/assignments.py`: schema, D-Day 함수, router
- `app/main.py`: router 등록
- `alembic/versions/*_create_assignments.py`: migration
- `tests/test_assignments.py`: DB·API·권한·날짜 테스트

기존 `get_db`, `get_current_user`, `User` model을 재사용한다. service, repository, subject table, D-Day cache는 만들지 않는다.

## 테스트 시나리오

| 영역 | 최소 시나리오 |
|---|---|
| 저장 | 사용자 외래 키, 필수값, subject 제약, timezone-aware timestamp |
| 생성 | trim, 과거 마감 허용, 잘못된 subject·offset 없는 시각 거절 |
| 목록 | 날짜 양 끝 포함, 최대 62일, 완료 filter, 고정 정렬 |
| D-Day | D-1, D-Day, 1일 지남, 한국 자정, 월·연도 경계 |
| 권한 | 사용자 B가 사용자 A의 ID로 조회·수정·완료·삭제하면 모두 `404` |
| 수정 | 일부 필드 변경, 빈 body·`null` 거절, `updatedAt` 변경 |
| 완료 | 완료·취소, 같은 요청 반복, 최초 `completedAt` 보존 |
| 대시보드 | 없음, 예정만, 지난 과제 포함, 완료 제외, 사용자별 격리 |
| 삭제 | `204`, 이후 조회·재삭제 `404` |
| 회귀 | 가입·로그인·현재 사용자 API가 계속 통과 |

## 완료 조건

- 모든 API가 이 문서의 요청·응답·오류 계약과 일치한다.
- 타 사용자 과제에 대한 모든 객체 단위 접근이 차단된다.
- D-Day가 Asia/Seoul 날짜 경계에서 일관되게 계산된다.
- model과 Alembic migration이 일치한다.
- `make check`와 `git diff --check`가 성공한다.
