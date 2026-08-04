# RECORDS Development Agent Guide

이 파일은 저장소 전체에 적용된다. 상위 `AGENTS.md`와 충돌하지 않는 범위에서 아래 규칙을 우선한다.

## 현재 목표

RECORDS는 FastAPI 단일 백엔드와 반응형 React 웹으로 시작한다. 현재 구현 범위는 다음 순서를 따른다.

1. 개발 하네스
2. 이메일·비밀번호 인증
3. 인증된 사용자별 과제(Assignment) TODO CRUD
4. 사진에서 과제 후보 자동 추출
5. 웹에서 인증·과제·사진 추출 API 연결

사진 자동 추출은 사용자가 결과를 확인·수정한 뒤 기존 과제 생성 API로 저장하는 흐름까지만 구현한다. 이메일 인증, Refresh Token, 푸시 알림, 관리자 기능, 마이크로서비스는 현재 범위가 아니다. 요구 없이 미리 추가하지 않는다.

## 작업 전 읽을 문서

- 개발·검증 절차: [`docs/development-workflow.md`](docs/development-workflow.md)
- 전체 구현 순서와 Task: [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md)
- 공통 API 응답과 예외 계약: [`docs/api-response.md`](docs/api-response.md)
- 완료된 인증 계약: [`docs/authentication.md`](docs/authentication.md)
- 구현된 과제 API·DB 계약: [`docs/assignments.md`](docs/assignments.md)
- 사진 자동 추출 계약: [`docs/photo-extraction.md`](docs/photo-extraction.md)
- 웹 클라이언트 실행·API 연결 계약: [`docs/web-client.md`](docs/web-client.md)
- 로컬 실행 명령: [`README.md`](README.md)

문서와 코드가 다르면 현재 코드와 테스트가 실행 사실의 기준이다. 과제 동작은 `docs/assignments.md`를 기준으로 유지하고, 계약을 바꿀 때는 코드보다 문서를 먼저 수정한다.

## 기술 방향

- Python 3.14와 프로젝트 루트 `.venv`를 사용한다.
- PostgreSQL만 Docker Compose에서 실행한다.
- FastAPI와 SQLAlchemy 2.x 동기 API를 사용한다.
- schema 변경은 Alembic migration으로만 수행한다.
- dependency는 `requirements.in`에 직접 추가하고 검증된 전체 버전을 `requirements.lock`에 반영한다.
- 현재 규모에서는 service, repository, interface 계층을 만들지 않는다. 중복되거나 분리할 실제 이유가 생길 때만 추출한다.
- 사용자 ID는 인증 토큰에서 얻는다. 요청 body나 query의 `user_id`를 신뢰하지 않는다.
- 웹은 `web/`의 Vite·React·TypeScript를 사용하고, 별도 상태 관리·라우팅 라이브러리는 실제 필요가 생기기 전까지 추가하지 않는다.
- 웹 access token은 탭 단위 `sessionStorage`에만 저장한다. 장기 로그인이나 refresh token은 현재 범위가 아니다.

## 개발 순서

모든 기능은 아래 순서를 지킨다.

1. 요구사항과 API·DB 계약을 문서에서 확정한다.
2. 실패하는 테스트로 필요한 동작을 확인한다.
3. 테스트를 통과하는 최소 코드를 작성한다.
4. migration, lint, 전체 테스트를 실행한다.
5. 관련 파일만 stage하고 하나의 동작 단위로 커밋한다.

실패 테스트는 구현 방향을 확인하는 동안만 사용한다. 깨진 테스트나 미완성 migration은 커밋하지 않는다.

## 필수 명령

```bash
make venv
make db-up
make check
make web-check
```

개발 중에는 변경 범위에 맞게 `make test`, `make lint`, `make migrate`를 실행하되, 커밋 전에는 반드시 `make check`를 통과시킨다.
웹을 변경한 커밋은 `make web-check`도 통과시킨다.

## 코드 규칙

- 입력 검증은 Pydantic schema에서 수행한다.
- 객체 권한은 DB 조회 조건에 인증 사용자 ID를 포함해 한 번에 검사한다.
- 비밀번호, JWT, 전체 요청 body를 로그에 남기지 않는다.
- 시간은 timezone-aware UTC로 저장한다.
- API 오류는 상태 코드와 안정적인 오류 `code`를 함께 반환한다.
- JSON 성공·오류 응답은 `docs/api-response.md`의 envelope를 사용한다. `204`는 빈 body를 유지한다.
- 새 dependency는 표준 라이브러리나 이미 설치된 패키지로 해결할 수 없을 때만 추가한다.
- 새 abstraction은 두 번째 실제 사용처가 생기기 전에는 추가하지 않는다.
- OpenAI 호출은 테스트에서 Mock 처리하고 실제 호출은 명시적인 PoC에서만 수행한다.
- API key, 원본 이미지, base64 payload, 전체 모델 응답을 로그에 남기지 않는다.

## 테스트 규칙

- SQLite로 PostgreSQL 테스트를 대체하지 않는다.
- endpoint 테스트는 FastAPI dependency override로 테스트 transaction의 Session을 사용한다.
- 정상 경로뿐 아니라 중복, 잘못된 입력, 인증 실패, 객체 소유권 위반을 테스트한다.
- 테스트 fixture에는 실제 이름, 이메일, 학번을 사용하지 않는다.
- 보안 로직은 테스트 없이 완료로 간주하지 않는다.

## Migration 규칙

- model을 변경한 뒤 `make migration name=<설명>`으로 생성한다.
- 생성된 SQL 변화와 downgrade를 직접 검토한다.
- 이미 커밋되거나 배포된 migration은 수정하지 않고 새 migration으로 보정한다.
- 애플리케이션 시작 시 자동 생성되는 `create_all()`은 사용하지 않는다.

## 커밋 규칙

- Conventional Commit 형식을 사용한다: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`.
- `git add .` 또는 `git add -A`를 사용하지 않고 의도한 파일만 stage한다.
- 하나의 커밋에는 하나의 검증 가능한 동작만 포함한다.
- `.venv`, `.env`, DB volume, cache, 비밀값은 커밋하지 않는다.
- 사용자 요청 없이 push, rebase, squash, force-push를 하지 않는다.

## 완료 조건

작업 완료 보고 전 다음을 확인한다.

- 문서와 API·schema 동작이 일치한다.
- `make check`가 성공한다.
- `git diff --check`가 성공한다.
- 의도하지 않은 파일이 stage되지 않았다.
- 완료된 작업이 검증 가능한 커밋으로 남아 있다.
