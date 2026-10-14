---
title: Azure OpenAI 메트릭과 토큰 비용 운영 가이드
description: 핵심 메트릭 정의, 경고 시작점, 비용 수식, 수집 지연과 운영 권장 사항
ms.date: 2026-10-14
---

## 먼저 구분할 세 가지 시간

1. API response의 usage: 응답 완료 시 토큰 수를 얻습니다.
2. Azure Monitor: native metric 집계, diagnostic export, LAW ingestion,
   Workbook refresh 때문에 관측에 추가 지연이 발생합니다.
3. Cost Management: 후행 비용 데이터입니다. 계약/offer별 반영 시점과 청구 대사가 필요합니다.

약 1일 지연을 모든 Metrics의 보편적인 특성이라고 설명하지 않습니다.
현재 고객의 지연 경로를 확인하고 API usage와 ingestion lag를 함께 측정합니다.
이 데모의 목표는 near-real-time 운영 추정이며 실시간 확정 청구나 hard budget enforcement가 아닙니다.

## 핵심 native metrics

REST 이름은 실제 리소스의 `az monitor metrics list-definitions`로 확인합니다.

| 메트릭 | 해석/집계 | 우선순위와 주의 |
| --- | --- | --- |
| AzureOpenAIRequests | 요청 수, Total, 모델 배포/StatusCode로 분리 | 성공·4xx·5xx·429를 구분 |
| ProcessedPromptTokens | 처리한 input token, Total | input 가격/volume 지표, 정확한 quota 예약량과 다름 |
| GeneratedTokens | 생성한 completion token, Total | output 가격 및 response 길이 확인 |
| TokenTransaction | input + output token, Total | 앞 두 지표와 다시 더하면 이중 계산 |
| AzureOpenAITTLTInMS | 마지막 byte까지의 시간 | native 집계와 client p95를 구분 |
| AzureOpenAITimeToResponse | streaming first response 관련 지표 | 현재 문서상 Standard 지원 제한이 있으므로 SKU 확인 |
| AzureOpenAINormalizedTBTInMS | token 간 generation 시간 | 지원 SKU, streaming 여부 확인 |
| AzureOpenAINormalizedTTFTInMS | prompt 길이로 정규화한 first byte | raw TTFT와 같은 값 아님 |
| AzureOpenAIProvisionedManagedUtilizationV2 | PTU 사용률 | PAYG 데모에는 적용하지 않음, 구 V1 대신 V2 |
| ActiveTokens | PTU 계열의 cached 제외 token | PAYG 가격 계산용 대체값 아님 |
| AzureOpenAIContextTokensCacheMatchRate | cache 관련 native 지표 | 지원 SKU 확인, 응답 cached_tokens와 분리 |
| Content Safety Blocked/Harmful/Safety 이벤트 | 서비스 안전 집계 | 실제 REST 이름과 dimensions를 조회, 요청 상세의 대체 아님 |

일반 Cognitive Services의 `Latency`, `BlockedCalls`, `ClientErrors`를 OpenAI 전용 지표로
혼동하지 않습니다. 공식 reference도 해당 legacy 지표의 OpenAI 사용을 경고합니다.
Native 평균 지연으로 p95를 계산할 수 없습니다. p95는 요청별 DurationMs를 사용합니다.
Diagnostic export는 multidimensional metrics의 dimension을 평탄화할 수 있으므로
모델별 분석에는 native Metrics API나 요청별 ledger를 사용하십시오.

## Alert 임계치의 시작점

아래 값은 서비스 보장이나 모든 고객의 권장 고정값이 아닙니다.
2주 이상 정상 패턴, peak traffic, 모델/region/SKU 및 고객 SLO에 맞춰 보정합니다.

| 신호 | 이 데모의 시작점 | 실무 판단 |
| --- | --- | --- |
| 서버/네트워크 오류 | 모델별 15분, 최소 20회, 5% 이상 | 401/403은 설정 오류, 안전 차단은 장애율에서 분리 |
| throttling | 모델별 15분, 최소 20회, 429 5% 이상 | quota, RPM/TPM, burst, retry 폭주 조사 |
| total duration p95 | 성공 호출 모델별 15분, 최소 20회, 5초 초과 | output/prompt 길이 및 reasoning 증가와 함께 비교 |
| streaming TTFT p95 | 모델별 15분, 최소 20개 TTFT, 3초 초과 | visible content 지연, native service latency와 대조 |
| stream incomplete | live 15분 내 3건 이상 | client cancellation과 transport/terminal 누락 구분 |
| 추정 비용 | 5분 합계 5 USD 이상 | 단가 설정된 요청만, 청구 budget과 별도 |
| 필터 실패 | live filter_unavailable 1건 이상 | 안전 검사를 못 한 응답의 표시/중단 정책 조사 |
| output token volume | 5분 GeneratedTokens 100,000 초과 | 시연용 임계치, quota 사용률 80%라는 뜻 아님 |

표본이 작은 고객은 비율 경고 대신 일정 기간 절대 오류 수/지속 실패 경고를 선택합니다.
시간대별 트래픽이 다른 서비스는 baseline/dynamic threshold와 maintenance suppression을 검토합니다.
PTU에서는 utilization V2 80~90%의 지속 증가를 용량 계획 신호로 삼을 수 있으나
정확한 경고값은 workload benchmark로 결정해야 합니다.

입력/output block rate는 별도 운영/정책 지표입니다.
차단 증가가 곧 서비스 장애나 공격이라는 결론은 아닙니다.
경고 sample의 fixture는 `demo.mode=fixture`이며 live alert 쿼리에서 제외합니다.

## 토큰 기반 추정 비용

```text
non_cached_input = prompt_tokens - cached_tokens
estimated_USD =
  (non_cached_input * input_price_per_1M
   + cached_tokens * cached_input_price_per_1M
   + completion_tokens * output_price_per_1M) / 1,000,000
```

예: input 1,000, cached 400, completion 200,
단가 input 0.15/cached 0.075/output 0.60 USD per million이면 0.00024 USD입니다.
이 숫자는 수학 예제이며 요청한 세 모델의 가격이 아닙니다.

* reasoning_tokens는 completion_tokens의 세부 항목으로 별도 합산하지 않습니다.
* usage 없는 400/429/timeout의 비용은 `null`이고 무료 요청으로 표시하지 않습니다.
* cached metadata가 없는 known usage는 input을 모두 uncached로 계산한 상한 성격 추정입니다.
* 모든 단가가 미설정이면 합계도 `null`, priced request coverage도 0으로 표시합니다.
* 알려진 비용만의 합계를 전체 확정 비용으로 표시하지 않습니다.
* image/audio/batch/fine-tuning/priority/flex/PTU 가격은 이 text PAYG 수식 밖입니다.
* PTU는 token당 요금이 아니라 capacity/약정 비용 모델을 적용해야 합니다.

단가 key는 모델 + 버전 + SKU입니다.
currency, effectiveFrom/inclusive, effectiveTo/exclusive, 출처와 검증 상태를 저장합니다.
[현재 단가](pricing.md)는 Azure 페이지/API의 정확한 축약 meter를 교차 확인한 retail 값입니다.
Short context/default processing 범위와 별도 cache-write meter를 구분합니다.
계약 가격/지역/data zone/서비스 tier를 반영하고, 단가를 바꿀 때 기존 ledger의 단가 버전을
재계산으로 조용히 덮어쓰지 않습니다.
현재 demo rate card는 2026-11-14에 만료되며 사용자가 재검증해야 합니다.

## 고객의 metric × 단가 방안 검토

분/5분 단위 `ProcessedPromptTokens`와 `GeneratedTokens`에 각각 단가를 적용하는 방법은
빠른 집계 추정으로 유용합니다. 다음 조건을 충족해야 합니다.

1. 배포/model/version/SKU별로 분리합니다.
2. input과 output을 같은 단가로 계산하지 않습니다.
3. cache 할인 정보가 없으면 상한 추정으로 설명합니다.
4. API usage ledger와 native metrics를 더하지 않고 두 경로를 대사합니다.
5. export 지연, sampling, 누락 usage, price coverage를 함께 표시합니다.
6. 일별 Cost Management와 계약/서비스별 차이를 대사합니다.

동일 호출자를 빠짐없이 계측할 수 있다면 응답 usage 기반 ledger를 우선합니다.
여러 호출자가 계측을 우회한다면 native metrics가 전체 volume 확인의 기준입니다.
APIM은 필요할 때 공통 ingress와 정책의 관측 범위를 확장하는 선택지입니다.

## 추가 운영 팁

* 월별 Budget alerts를 별도 구성합니다. Budget은 자동 hard cap이 아닙니다.
* 성공/오류/차단, logical request/attempt, retry를 분리해 재시도 비용과 폭주를 관측합니다.
* `max_completion_tokens` 상한과 concurrency/queue를 관리합니다.
* 429에는 Retry-After 및 지수 backoff+jitter를 고려하고 필터 차단은 그대로 retry하지 않습니다.
* 모델 버전 고정과 retirement 알림, API version 호환성을 운영 변경 관리에 포함합니다.
* continuous production에서는 ingestion freshness와 usage coverage 경고를 추가합니다.
  단발성 CLI 데모에서 no-traffic 경고를 켜지 않습니다.
* 비용 ledger를 trace sampling에 의존시키지 않습니다. 이 데모는 sampler를 추가하지 않습니다.
* LAW daily cap 이후 관측 중단, retention, RBAC, 수집 비용을 모니터링합니다.
* 정상 입력 코호트로 가드레일 오탐/누락과 한국어 품질을 별도 평가합니다.
  이 데모는 품질 benchmark나 evaluation score를 만들어내지 않습니다.
