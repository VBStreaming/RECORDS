# How to run Kyelendar locally

이 문서는 저장소를 처음 받은 개발자가 PostgreSQL, FastAPI API, React 웹을 자신의 컴퓨터에서 실행하는 절차다.

## 1. 준비물

다음 명령이 모두 실행되어야 한다.

```bash
git --version
python3.14 --version
node --version
npm --version
docker --version
docker compose version
make --version
```

권장 기준:

- Python 3.14
- Node.js 22
- Docker Desktop 또는 Docker Engine과 Docker Compose
- GNU Make

Windows에서는 Docker Desktop과 WSL2의 Linux 터미널 사용을 권장한다. 이후 명령은 macOS, Linux, WSL2의 Bash 또는 Zsh를 기준으로 한다.

## 2. 저장소 받기

```bash
git clone https://github.com/VBStreaming/RECORDS.git
cd RECORDS
```

## 3. Python 가상환경 만들기

프로젝트 루트에 `.venv`를 만들고 잠긴 버전의 패키지를 설치한다.

```bash
make venv
```

Python 실행 파일 이름이 다르면 경로를 지정한다.

```bash
make venv PYTHON=/absolute/path/to/python3.14
```

설치 확인:

```bash
.venv/bin/python --version
.venv/bin/uvicorn --version
```

## 4. 로컬 환경변수 설정하기

예제 파일을 복사한다.

```bash
cp .env.example .env
```

JWT 서명 키를 생성한다.

```bash
.venv/bin/python -c "import secrets; print(secrets.token_urlsafe(48))"
```

출력된 값을 `.env`의 `JWT_SECRET_KEY`에 넣는다. `.env`는 Git에 커밋하지 않는다.

기본 개발에서는 사진 자동 추출을 꺼둔다.

```dotenv
AI_EXTRACTION_ENABLED=false
OPENAI_API_KEY=
```

사진 자동 추출을 직접 시험할 때만 자신의 OpenAI API key를 입력하고 `AI_EXTRACTION_ENABLED=true`로 변경한다. 사진을 선택하는 것만으로는 비용이 발생하지 않지만, 웹에서 `사진에서 과제 찾기`를 누르면 실제 API 요청과 비용이 발생한다.

## 5. PostgreSQL 실행과 마이그레이션

Docker로 개발 DB와 테스트 DB를 준비하고 schema를 적용한다.

```bash
make db-up
make migrate
```

## 6. API 서버 실행

첫 번째 터미널에서 실행한다.

```bash
make dev
```

다음 주소를 확인한다.

- API 문서: <http://127.0.0.1:8000/docs>
- 프로세스 상태: <http://127.0.0.1:8000/health/live>
- DB 연결 상태: <http://127.0.0.1:8000/health/ready>

정상 응답 예시:

```json
{"success":true,"data":{"status":"ok"},"error":null}
```

## 7. 웹 실행

두 번째 터미널에서 웹 의존성을 설치하고 개발 서버를 실행한다.

```bash
make web-install
make web-dev
```

브라우저에서 <http://127.0.0.1:5173>을 연다. 로컬 Vite 서버가 `/api` 요청을 `http://127.0.0.1:8000`으로 전달하므로 별도 CORS 설정은 필요하지 않다.

다음 흐름으로 연결을 확인한다.

1. 새 이메일로 회원가입한다.
2. 로그인한다.
3. `직접 추가`로 과제를 만든다.
4. 달력과 D-Day에 과제가 표시되는지 확인한다.
5. 체크 버튼으로 완료와 완료 취소를 확인한다.

## 8. 전체 검증

백엔드 migration, lint, 테스트를 실행한다.

```bash
make check
```

웹 TypeScript 검사와 production build를 실행한다.

```bash
make web-check
```

현재 기준으로 백엔드는 60개 테스트가 통과해야 한다. OpenAI 호출은 테스트에서 Mock 처리되므로 `make check`로 비용이 발생하지 않는다.

## 9. 종료

API와 웹 개발 서버는 각각 실행 중인 터미널에서 `Ctrl+C`로 종료한다. PostgreSQL을 중지한다.

```bash
make db-down
```

`make db-down`은 컨테이너만 중지하며 Docker volume의 로컬 DB 데이터는 유지한다.

## 문제 해결

### `python3.14: command not found`

Python 3.14를 설치한 뒤 `make venv PYTHON=/absolute/path/to/python3.14`처럼 실제 실행 파일 경로를 넘긴다.

### Docker DB가 시작되지 않음

Docker가 실행 중인지 확인하고 PostgreSQL 포트 `54329`가 사용 중인지 검사한다.

```bash
docker compose ps
lsof -i :54329
```

### `records_test` 데이터베이스가 없음

오래된 Docker volume을 재사용하는 환경에서 테스트 DB만 없다면 다음 명령으로 생성한다.

```bash
docker compose exec db createdb -U records records_test
make migrate-test
```

### 웹에서 API 요청 실패

API 서버와 웹 서버를 모두 실행했는지 확인한다.

```bash
curl http://127.0.0.1:8000/health/live
curl http://127.0.0.1:8000/health/ready
```

웹은 `127.0.0.1:5173`, API는 `127.0.0.1:8000`을 사용한다. 다른 포트로 실행했다면 `web/vite.config.ts`의 개발 proxy도 일치해야 한다.

### 사진 자동 추출이 `503 AI_EXTRACTION_DISABLED`를 반환함

기본값으로 비활성화된 정상 동작이다. 기능을 시험할 때만 `.env`에 `AI_EXTRACTION_ENABLED=true`와 유효한 `OPENAI_API_KEY`를 설정하고 API 서버를 재시작한다. 자세한 제한은 [사진 과제 자동 추출 계약](photo-extraction.md)을 참고한다.
