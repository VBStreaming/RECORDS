# 인증 구현 계약

상태: **다음 구현 작업, 아직 API에 존재하지 않음**

이 문서는 최초 인증 기능의 고정 계약이다. 범위는 가입, 로그인, 현재 사용자 조회이며 Refresh Token, 이메일 인증, 비밀번호 재설정은 포함하지 않는다.

## 사용자 모델

`users` 테이블은 다음 column만 가진다.

| Column | Type | 제약 |
|---|---|---|
| `id` | UUID | Primary key, 애플리케이션에서 UUID4 생성 |
| `name` | VARCHAR(50) | 필수, 앞뒤 공백 제거 후 1~50자 |
| `email` | VARCHAR(254) | 필수, 소문자 정규화, unique |
| `student_number` | CHAR(5) | 필수, 숫자 5자리, 중복 허용 |
| `password_hash` | TEXT | 필수, Argon2 hash만 저장 |
| `created_at` | TIMESTAMPTZ | 필수, DB의 현재 UTC 시각 |

학번은 프로필 정보일 뿐 로그인, 권한, 사용자 유일성 판단에 사용하지 않는다.

## API

### `POST /auth/signup`

요청:

```json
{
  "name": "테스트학생",
  "email": "student@example.com",
  "studentNumber": "10311",
  "password": "example-password"
}
```

검증:

- `name`: trim 후 1~50자
- `email`: 유효한 이메일, trim·소문자 변환 후 최대 254자
- `studentNumber`: `^[0-9]{5}$`
- `password`: 10~128자

성공: `201 Created`

```json
{
  "id": "5fbbb3f2-f55d-4652-b138-3595e527ba37",
  "name": "테스트학생",
  "email": "student@example.com",
  "studentNumber": "10311"
}
```

오류:

- `409 EMAIL_ALREADY_EXISTS`: 대소문자가 다른 동일 이메일 포함
- `422 VALIDATION_ERROR`: 필드 형식 또는 길이 오류

응답과 로그에 `password`와 `password_hash`를 포함하지 않는다.

### `POST /auth/login`

요청:

```json
{
  "email": "student@example.com",
  "password": "example-password"
}
```

성공: `200 OK`

```json
{
  "accessToken": "<signed-jwt>",
  "tokenType": "bearer",
  "expiresIn": 1800
}
```

존재하지 않는 이메일과 잘못된 비밀번호는 모두 같은 `401 INVALID_CREDENTIALS`를 반환한다. 계정 존재 여부와 어느 필드가 틀렸는지 노출하지 않는다.

### `GET /users/me`

요청 header:

```text
Authorization: Bearer <access-token>
```

성공 응답은 가입 성공 응답과 같다.

오류:

- token 누락: `401 INVALID_TOKEN`
- token 위조·형식 오류·만료: `401 INVALID_TOKEN`
- token의 사용자가 DB에 없음: `401 INVALID_TOKEN`

모든 `401` 응답은 `WWW-Authenticate: Bearer` header를 포함한다.

## 오류 형식

인증 API가 직접 발생시키는 오류는 다음 형태를 사용한다.

```json
{
  "detail": {
    "code": "INVALID_CREDENTIALS",
    "message": "이메일 또는 비밀번호가 올바르지 않습니다."
  }
}
```

Pydantic 입력 검증 오류의 기본 `422` 형식은 이번 작업에서 별도 변환하지 않는다.

## 비밀번호와 JWT

- FastAPI 공식 권장 조합인 `pwdlib[argon2]`와 `PyJWT`를 사용한다.
- 비밀번호 원문은 저장하거나 로그에 남기지 않는다.
- JWT algorithm은 `HS256`이다.
- `JWT_SECRET_KEY`는 최소 32 random bytes이며 `.env`와 운영 secret으로만 제공한다.
- Access Token 만료는 30분이다.
- payload에는 `sub`, `iat`, `exp`만 넣는다.
- `sub`는 사용자 UUID 문자열이다. 이름, 이메일, 학번은 넣지 않는다.

## 최소 파일 변경

인증 구현은 다음 파일만 추가·수정하는 것을 기본으로 한다.

- `app/models.py`: `User` SQLAlchemy model
- `app/auth.py`: schema, password·JWT 함수, 인증 dependency, router
- `app/config.py`: JWT 설정
- `app/main.py`: 인증 router 등록
- `alembic/versions/*_create_users.py`: schema migration
- `tests/conftest.py`: endpoint용 DB Session override
- `tests/test_auth.py`: 인증 동작 테스트
- dependency와 환경설정 파일

service·repository·JWT provider interface는 만들지 않는다.

## 테스트 시나리오

| 시나리오 | 기대 결과 |
|---|---|
| 정상 가입 | `201`, 사용자 응답, DB에는 Argon2 hash 저장 |
| 같은 이메일 재가입 | `409 EMAIL_ALREADY_EXISTS` |
| 이메일 대소문자만 변경 | 동일한 중복으로 처리 |
| 학번 중복 | 가입 허용 |
| 잘못된 학번·짧은 비밀번호 | `422` |
| 정상 로그인 | 30분 Access Token 발급 |
| 없는 이메일·틀린 비밀번호 | 동일한 `401` 응답 |
| 정상 token으로 `/users/me` | 자신의 정보 반환 |
| token 없음·위조·만료 | `401 INVALID_TOKEN` |
| password 또는 hash 응답 노출 | 테스트 실패 |

## 구현·커밋 순서

각 단계에서 테스트를 먼저 실패시킨 뒤 최소 구현으로 통과시킨다. 커밋은 `make check`가 성공한 상태에서만 만든다.

1. `feat: add user persistence`
   - model, migration, model 검증 테스트
2. `feat: implement user signup`
   - schema, Argon2, 이메일 중복, 가입 endpoint
3. `feat: implement login and current user`
   - JWT, 로그인, 인증 dependency, `/users/me`

## 완료 조건

- 위 API와 오류 계약이 OpenAPI와 테스트에 반영된다.
- 사용자 비밀번호 원문이 DB·응답·로그 어디에도 없다.
- 중복 이메일이 DB unique constraint와 API 양쪽에서 차단된다.
- 위조·만료 JWT가 사용자 조회에 사용되지 않는다.
- `make check`와 `git diff --check`가 성공한다.

## 후속 작업

인증 완료 후 사용자별 TODO CRUD를 구현한다. TODO 조회·수정·삭제는 반드시 `todo.id`와 인증 사용자의 `user_id`를 함께 조건으로 사용한다.
