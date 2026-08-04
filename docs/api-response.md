# 공통 API 응답과 전역 예외 처리 계약

상태: **구현 예정**

이 문서는 RECORDS API의 JSON 성공·오류 응답 형식과 전역 예외 처리 규칙을 정의한다. `/docs`, `/openapi.json`과 body가 없는 `204 No Content` 응답은 envelope 대상이 아니다.

## 성공 응답

JSON body가 있는 모든 정상 응답은 다음 구조를 사용한다.

```json
{
  "success": true,
  "data": {
    "id": "6b6e46da-65db-4b06-acbc-ecf4283fb03d"
  },
  "error": null
}
```

- `success`는 항상 `true`다.
- `data`에는 기존 endpoint의 실제 응답 객체, 배열 또는 상태값이 들어간다.
- `error`는 항상 `null`이다.
- 목록이 비어 있으면 `data`는 `[]`다. 성공 응답의 `data`를 `null`로 사용하지 않는다.
- 과제 삭제 성공은 `204 No Content`와 빈 body를 유지한다.

## 오류 응답

처리 가능한 모든 API 오류는 다음 구조를 사용한다.

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ASSIGNMENT_NOT_FOUND",
    "message": "과제를 찾을 수 없습니다.",
    "details": null
  }
}
```

- `success`는 항상 `false`다.
- `data`는 항상 `null`이다.
- `error.code`는 클라이언트 분기용 안정적인 영문 대문자 code다.
- `error.message`는 사용자에게 표시 가능한 한국어 설명이다.
- `error.details`는 입력 검증 오류에만 배열이며 그 외에는 `null`이다.
- stack trace, SQL, 비밀번호, JWT, 요청 body는 응답과 로그에 포함하지 않는다.

## 입력 검증 오류

FastAPI/Pydantic 검증 실패는 `422 VALIDATION_ERROR`로 변환한다.

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "요청 값이 올바르지 않습니다.",
    "details": [
      {
        "field": "body.studentNumber",
        "message": "String should match pattern '^[0-9]{5}$'",
        "type": "string_pattern_mismatch"
      }
    ]
  }
}
```

검증 detail은 `field`, `message`, `type`만 제공한다. Pydantic의 입력 원문과 내부 context는 노출하지 않는다.

## 전역 예외 변환

| 발생 예외 | HTTP 상태 | 기본 code | 처리 규칙 |
|---|---:|---|---|
| 명시적 `HTTPException` | 원래 상태 유지 | 예외에 지정된 code | 기존 code·message와 header 보존 |
| 라우팅 404 | `404` | `NOT_FOUND` | 존재하지 않는 API 경로 |
| 허용되지 않은 method | `405` | `METHOD_NOT_ALLOWED` | framework 오류를 공통 형식으로 변환 |
| `RequestValidationError` | `422` | `VALIDATION_ERROR` | 안전한 field detail만 반환 |
| `SQLAlchemyError` | `503` | `DATABASE_UNAVAILABLE` | 내부 오류를 기록하고 DB 정보는 숨김 |
| 그 외 처리되지 않은 예외 | `500` | `INTERNAL_SERVER_ERROR` | 내부 오류를 기록하고 고정 메시지 반환 |

인증 오류의 `WWW-Authenticate: Bearer`처럼 기존 HTTP header가 있으면 전역 handler가 그대로 전달한다.

## 기존 업무 오류 code

| Code | 상태 | 의미 |
|---|---:|---|
| `EMAIL_ALREADY_EXISTS` | `409` | 이미 사용 중인 이메일 |
| `INVALID_CREDENTIALS` | `401` | 로그인 정보 불일치 |
| `INVALID_TOKEN` | `401` | token 없음, 위조, 만료 또는 사용자 없음 |
| `ASSIGNMENT_NOT_FOUND` | `404` | 과제가 없거나 현재 사용자 소유가 아님 |

업무 오류를 새로 추가할 때 endpoint에서는 `HTTPException`에 `code`와 `message`만 지정하고, JSON envelope 생성은 전역 handler에 맡긴다.

## 구현 경계

- `app/responses.py`: 성공·오류 Pydantic model과 성공 helper
- `app/exceptions.py`: HTTP, 검증, DB, 미처리 예외 handler와 등록 함수
- `app/main.py`: handler를 애플리케이션에 한 번 등록
- 기존 router: 성공 response model을 공통 generic envelope로 변경

middleware로 응답 body를 사후 변환하지 않는다. endpoint의 `response_model` 자체가 실제 envelope를 표현해야 OpenAPI와 런타임 응답이 일치한다.

## 테스트 시나리오

| 시나리오 | 기대 결과 |
|---|---|
| 가입·로그인·과제·대시보드 성공 | `success=true`, 실제 값은 `data`, `error=null` |
| 빈 과제 목록 | `data=[]` |
| 과제 삭제 | `204`, 빈 body |
| 잘못된 입력 | `422 VALIDATION_ERROR`, 안전한 details |
| 기존 인증·업무 오류 | 기존 HTTP 상태와 code 유지 |
| 존재하지 않는 경로 | `404 NOT_FOUND` 공통 오류 응답 |
| DB 예외 | `503 DATABASE_UNAVAILABLE`, SQL 미노출 |
| 예상하지 못한 예외 | `500 INTERNAL_SERVER_ERROR`, 내부 메시지 미노출 |
| OpenAPI | 성공 endpoint가 `ApiResponse[...]` schema를 표시 |

## 완료 조건

- JSON body를 반환하는 모든 현재 endpoint가 성공 envelope를 사용한다.
- framework와 애플리케이션 오류가 공통 오류 envelope를 사용한다.
- 인증 header와 업무 오류 code가 보존된다.
- validation 응답에 요청 입력 원문이 포함되지 않는다.
- `204`와 OpenAPI 문서 endpoint가 불필요하게 감싸지지 않는다.
- `make check`와 `git diff --check`가 성공한다.
