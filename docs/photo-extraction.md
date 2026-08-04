# 사진 과제 자동 추출 계약

상태: **Mock 구현 완료, 실모델 PoC 대기**

## 사용자 흐름

```text
로그인 → 사진 전송 → 과제 후보 자동 추출 → 사용자 확인·수정 → POST /assignments
```

추출 결과는 과제를 자동 생성하지 않는다. 읽을 수 없는 값은 추측하지 않고 `null`로 반환하며 사용자가 확인한 값만 기존 과제 생성 API로 저장한다. 한 사진에 여러 과제가 있을 수 있으므로 최대 5개 후보를 반환한다.

## API

### `POST /assignment-extractions`

- 인증: Bearer Access Token 필수
- 요청: `multipart/form-data`의 `image` 파일 1개
- 허용 형식: 실제 파일 형식이 JPEG, PNG, WebP인 이미지
- 최대 요청 파일 크기: 5 MiB
- 최대 이미지 픽셀 수: 20,000,000
- 처리: EXIF 방향 보정, RGB JPEG 재인코딩, 긴 변 2,048px 이하 축소
- 저장: 서버와 DB에 원본 또는 변환 이미지를 저장하지 않음

성공 응답 예시:

```json
{
  "success": true,
  "data": {
    "candidates": [
      {
        "title": "수학 프린트 3장",
        "subject": "MATH",
        "dueAt": "2026-08-11T23:59:00+09:00",
        "needsReview": []
      }
    ],
    "requiresConfirmation": true,
    "warnings": []
  },
  "error": null
}
```

`subject`는 기존 `SubjectCode` 또는 `null`만 허용한다. `needsReview`에는 `title`, `subject`, `dueAt` 중 사용자가 반드시 확인해야 하는 필드가 들어간다. 후보가 없어도 정상 분석이면 빈 배열을 반환할 수 있다.

## 오류

| 상태 | code | 조건 |
|---:|---|---|
| 400 | `INVALID_IMAGE` | 빈 파일, 허용하지 않은 MIME 또는 실제 이미지 형식, 손상 이미지, 크기·픽셀 제한 초과 |
| 401 | `INVALID_TOKEN` | 인증 실패 |
| 429 | `AI_RATE_LIMITED` | OpenAI 사용량 또는 호출 제한 도달 |
| 502 | `AI_EXTRACTION_FAILED` | OpenAI 응답 실패, 시간 초과, 구조화 결과 없음 |
| 503 | `AI_EXTRACTION_DISABLED` | 기능 비활성화 또는 API key 미설정 |

오류 응답은 공통 envelope를 사용한다. 외부 서비스의 상세 오류, API key, 이미지 내용은 응답과 로그에 포함하지 않는다. 외부 호출은 자동 재시도하지 않는다.

## 모델과 비용 제한

- 기본 모델: `gpt-5-nano`
- API: OpenAI Responses API와 Pydantic Structured Outputs
- 이미지 detail: `high`
- reasoning effort: `minimal`
- 최대 출력: 400 tokens
- Responses 저장: `store=false`
- 자동 고급 모델 재시도: 하지 않음
- 테스트와 CI: OpenAI 호출을 Mock 처리

환경 변수:

```dotenv
AI_EXTRACTION_ENABLED=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-nano
OPENAI_IMAGE_DETAIL=high
OPENAI_MAX_OUTPUT_TOKENS=400
OPENAI_MAX_REQUESTS=14
```

PoC에서는 개인정보가 없는 합성·비식별 이미지만 사용한다. 프로세스당 실제 호출을 최대 14회로 제한하고, Nano 최대 10회와 실패 사례 비교용 Luna 최대 3회만 사용한다. 누적 사용액이 0.25 USD에 도달하면 중단한다. 이 제한은 서버 재시작 시 초기화되므로 공개 배포 전에는 OpenAI 프로젝트 지출 제한과 영속적인 사용자별 할당량이 필요하다.

## 날짜 규칙

- 모델에는 요청 시점의 `Asia/Seoul` 날짜와 시간대를 함께 제공한다.
- 명시적인 시간이 없으면 해당 날짜의 `23:59 Asia/Seoul`을 사용한다.
- 연도나 날짜가 불명확하면 추측하지 않고 `dueAt=null`과 `needsReview=["dueAt"]`을 반환한다.
- 상대 날짜는 제공한 기준 시각으로 계산하되 사용자가 저장 전에 확인한다.

## 개인정보 및 로그

- OpenAI 요청은 `store=false`로 전송한다.
- API key, 원본 파일명, 이미지 bytes/base64, 전체 prompt와 모델 원문 응답을 기록하지 않는다.
- 테스트 fixture에는 실제 학생, 학교, 얼굴, 교실 정보가 포함된 사진을 사용하지 않는다.
- 원본과 재인코딩 이미지는 요청 처리 메모리에서만 사용하고 응답 후 참조를 보존하지 않는다.

## 완료 조건

- 인증 없이는 호출할 수 없다.
- 위조 확장자와 손상 이미지를 `400 INVALID_IMAGE`로 거절한다.
- 변환 이미지에서 EXIF가 제거되고 최대 변 크기와 픽셀 제한을 지킨다.
- Mock 응답이 공통 응답 schema로 반환되며 DB에 과제가 자동 생성되지 않는다.
- OpenAI 오류가 안정적인 공통 오류 code로 변환된다.
- `make check`가 실제 OpenAI 호출 없이 성공한다.
