# How to: Kyelendar 백엔드 기능 개발

이 문서는 Kyelendar 백엔드에서 기능 하나를 안전하게 추가하고 커밋하는 절차를 설명한다. 현재 하네스는 Python 애플리케이션을 로컬 `.venv`에서 실행하고 PostgreSQL만 Docker에서 실행한다.

## 준비 사항

- `/opt/homebrew/bin/python3.14`
- Docker와 Docker Compose
- 프로젝트 루트에서 실행할 `make`

## 최초 실행

1. Python 가상환경과 고정 dependency를 설치한다.

   ```bash
   make venv
   ```

2. 개발·테스트 PostgreSQL을 시작한다.

   ```bash
   make db-up
   ```

3. migration, lint, 테스트를 한 번에 확인한다.

   ```bash
   make check
   ```

4. 개발 서버를 시작한다.

   ```bash
   make dev
   ```

5. 실행 결과를 확인한다.

   ```bash
   curl http://127.0.0.1:8000/health/live
   curl http://127.0.0.1:8000/health/ready
   ```

   두 요청 모두 `200`을 반환해야 한다. OpenAPI 문서는 `http://127.0.0.1:8000/docs`에서 확인한다.

## 기능 개발 순서

### 1. 계약을 먼저 고정한다

구현 전에 요청·응답, 오류, DB 제약, 권한, 완료 조건을 `docs/`에 작성한다. 전체 순서는 [`implementation-roadmap.md`](implementation-roadmap.md), 다음 과제 기능의 상세 계약은 [`assignments.md`](assignments.md)를 따른다.

### 2. 실패 테스트를 작성한다

테스트 이름은 사용자에게 보이는 동작을 표현한다.

```python
def test_signup_rejects_duplicate_email() -> None:
    ...
```

테스트를 실행해 구현이 없어서 실패하는지 확인한다. 테스트 자체의 import 오류나 fixture 오류는 올바른 실패가 아니다.

### 3. 최소 코드를 구현한다

현재 규모에서는 endpoint가 SQLAlchemy Session을 직접 사용한다. service·repository 계층을 미리 만들지 않는다. 공통 동작이 실제로 두 곳 이상에서 반복될 때만 함수나 모듈로 추출한다.

### 4. DB 변경을 migration으로 남긴다

```bash
make migration name=create_users
make migrate
```

생성된 migration의 column type, nullable, unique, index, downgrade를 직접 읽는다. `Base.metadata.create_all()`로 schema를 우회하지 않는다.

### 5. 전체 품질 게이트를 실행한다

```bash
make check
git diff --check
```

`make check`는 개발 DB migration, Ruff, 테스트 DB 기반 pytest를 순서대로 실행한다.

### 6. 검증된 단위만 커밋한다

```bash
git add <이번 작업 파일들>
git diff --cached --check
git commit -m "feat: implement signup"
```

실패 테스트는 로컬 개발 순서에는 포함되지만 커밋에는 통과하는 구현과 함께 남긴다.

## DB 테스트 방법

endpoint가 DB를 사용할 때는 `get_db` dependency를 테스트 transaction에 묶인 Session으로 override한다. endpoint가 별도 connection을 열면 fixture rollback 밖에 데이터가 남으므로 금지한다.

각 테스트는 다음 원칙을 따른다.

- 테스트 종료 후 transaction rollback
- PostgreSQL 전용 제약과 type을 실제 PostgreSQL에서 검증
- 테스트마다 독립된 가상 사용자 데이터 사용
- 사용자 A와 B를 만들어 객체 소유권 검증

## Dependency 변경

1. 직접 dependency와 버전을 `requirements.in`에 추가한다.
2. `.venv`에서 설치하고 관련 테스트를 실행한다.
3. `make lock`으로 `requirements.lock`을 갱신한다.
4. `pip check`와 `make check`를 실행한다.
5. 두 requirements 파일을 같은 커밋에 포함한다.

삭제된 dependency가 `.venv`에 남아 잠금 파일에 포함될 수 있으므로 `make lock` 결과에서 불필요한 패키지를 확인한다.

## 문제 해결

### PostgreSQL 5432 포트가 이미 사용 중이다

이 프로젝트는 호스트의 `54329`를 사용한다. `.env`에서 URL을 바꿨다면 `compose.yaml`의 port와 동일하게 맞춘다.

### `records_test`가 없다는 오류가 발생한다

테스트 DB는 PostgreSQL volume 최초 생성 시 만들어진다. 보존할 로컬 데이터가 없다면 `docker compose down -v`로 개발 volume을 삭제한 뒤 `make db-up`을 실행할 수 있다. 이 명령은 로컬 DB 데이터를 삭제하므로 필요한 데이터가 있는지 먼저 확인한다.

### readiness만 503을 반환한다

API 프로세스는 실행 중이지만 DB 연결이 실패한 상태다. `docker compose ps`, `make db-up`, `DATABASE_URL`을 확인한다.

## 작업 종료

```bash
make check
git status --short
make db-down
```

DB를 계속 사용할 예정이면 `make db-down`은 생략할 수 있다.
