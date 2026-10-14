---
title: 고객용 Azure OpenAI Monitoring Demo Runbook
description: 15분 시연, 모델 비교, 비용 단가 매핑, 필터 replay와 검증 절차
ms.date: 2026-10-14
---

## 시연 전 확인

1. Node 22+, PowerShell 7, `npm ci`, `npm test`를 완료합니다.
2. 해당 구독/region에서 모든 모델의 availability/quota/버전을 확인합니다.
3. Bicep validate와 what-if를 검토하고 별도 demo RG에만 배포합니다.
4. 사용자 Entra OpenAI User 역할의 전파 시간을 고려합니다.
5. LAW/App Insights 수집 및 query 권한을 확인합니다.
6. 현재 Azure retail rate card와 계약 가격의 차이, short context 적용 범위를 설명합니다.
7. email receiver가 없다면 notification 전달 테스트라고 설명하지 않습니다.

## 15분 발표 흐름

| 시간 | 시연 | 전달 메시지 |
| --- | --- | --- |
| 0~2분 | 아키텍처와 고객 요구 매핑 | native metric/요청 ledger/청구 데이터의 구분 |
| 2~5분 | 모델별 live 1회 streaming 호출 | TTFT, duration, final usage, annotation coverage |
| 5~8분 | 독립적인 cached token 비용 수식 | 실시간 확정 청구가 아니라 운영 추정 |
| 8~11분 | 3개 모델 × 9개 fixture replay | block/failure/취소/incomplete를 분리 |
| 11~14분 | Azure native Dashboard/Workbook과 Hybrid | live/fixture, streaming, 공식 retail 추정과 과거 재계산 |
| 14~15분 | 테스트 알림 메일과 production 확장 | Common Alert Schema, baseline/SLO 튜닝, 원문 최소화 |

수집 지연에 대비해 사전 실행 run UUID와 검증 결과를 준비합니다.
데이터가 안 보이면 live 성공을 연출하지 말고 실제 ingestion 상태를 설명합니다.

## 실행 명령

```powershell
npm test
.\scripts\Use-Demo.ps1 -Mode offline
.\scripts\Use-Demo.ps1 -Mode live -CountPerModel 1
.\scripts\Use-Demo.ps1 -Mode replay
.\scripts\Use-Demo.ps1 -Mode verify `
  -LiveRunId "<live-uuid>" -ReplayRunId "<replay-uuid>" -CountPerModel 1
```

`live`는 safe counting text만 streaming 호출하며 output 상한 128 tokens, SDK 자동 retry 0입니다.
reasoning 모델은 상한 대부분을 reasoning에 사용할 수 있습니다.
내용 생성 품질 대신 usage/latency/observability를 검증합니다.
models의 capacity 단위와 TPM/RPM 환산은 모델별 서비스 정의를 따릅니다.

## Workbook 확인

배포 결과의 `workbookResourceId`를 Azure Portal에서 엽니다.

* Live accounting: deployment별 Attempts, KnownUsage, UnknownUsage, PricedAttempts, nullable USD.
* Live token trend: prompt, completion, cached token.
* Live outcomes: 성공/차단/429/필터 실패.
* Annotation grid: source/category/severity.
* Synthetic fixtures: 실제 서비스 사고/과금과 분리된 27개 record.
* Streaming: TTFT, duration, chunk gap, final usage coverage, 취소/incomplete.
* Native exported metrics: 수집 여부 확인, 모델 dimensions 보존을 전제하지 않음.

Native Metrics에서는 OpenAI Requests를 deployment/StatusCode로 나누고
prompt/output token 및 실제 지원 latency 지표를 표시합니다.

[이메일 시나리오](alert-email.md)에 따라 주소 인증 완료와 테스트 메일 결과를 확인합니다.
Action Group 테스트 메일은 실제 Alert rule firing이나 모델 사고를 의미하지 않습니다.

## 중지할 때까지 반복하는 부하와 알람

### 웹 앱에서 실행과 중지

게시된 [모델 부하 실험실](https://white-stone-0001f860f.3.azurestaticapps.net)에서
GitHub 로그인 없이 접속합니다. 입력 반복, 출력 토큰, 총 호출 수, 목표 RPS,
동시 요청 수와 세 배포의 비율(합계 100%)을 설정하고 `실행 시작`을 누릅니다.
`신규 요청 중지`는 서버에 중지 상태를 저장하며 이미 전송한 요청의 완료는 기다립니다.
탭을 닫으면 신규 호출이 발생하지 않고 새로고침 후 자동 재개하지 않습니다.
웹 실행은 최대 500회의 유한 실행이며 기존 무기한 로컬 worker와 다릅니다.

`SYNTHETIC 알림 재현`은 실제 유해 요청 대신 합성 이벤트로 경고 경로를 확인합니다.
LIVE 숫자의 Azure 429는 모델 서비스 응답이며, 앱 자체의 HTTP 429와 구분합니다.
세 배포는 `gpt-6-luna`, `gpt-5.6-luna`, `gpt-5.6-terra`입니다.
안전한 입력 probe가 실제 필터 차단을 보장하지는 않습니다.

웹 앱 전환 시 기존 로컬 worker를 중지했습니다. 공개 고객 데모에서는
실행은 run ID별로 독립 유지되며 여러 방문자가 동시에 시작할 수 있습니다.
SYNTHETIC 15분 재실행 제한, 앱 일일 비용 상한과 서버 동시 요청 슬롯/64개 상한은 제거했습니다.
사용자가 지정한 목표 동시 요청 수와 RPS, Azure 서비스 quota는 그대로 적용됩니다.
민감한 입력을 넣지 마세요. 공개 HTTP API와 달리 Storage는 조직 정책 때문에
VNet과 private endpoint를 유지합니다. 정책 예외나 공개 Blob 접근은 사용하지 않습니다.
실제 유료 호출, 경고 Fired, 이메일 inbox 도착은 서로 다른 검증 항목입니다.
과거 로컬 실행 증거를 클라우드 검증으로 설명하지 않습니다.

2026-10-14 공개 API와 브라우저에서 세 배포를 각각 1회씩 호출하여
총 6회 LIVE 성공 및 LAW 적재를 확인했습니다.
브라우저 run `32870ed6-c444-415d-933d-30e220a081df`의 합성 이벤트 27개도 별도 적재했습니다.
해당 실행 이후 guardrail은 14:58:51Z, throttle은 14:59:12Z에
`SYNTHETIC DEMO` Fired를 확인했습니다. 실제 모델 차단이나 429 발생 증거는 아닙니다.
이메일 수신자는 Enabled이지만 실제 수신함 도착은 접근 권한이 없어 미검증입니다.

웹 앱은 비용 추정치를 관측하지만 비용 상한으로 호출을 차단하지 않으며 기존 70% 예산 경고는 비활성화합니다.
공개 데모 사용량에 따라 비용이 계속 발생하므로 테스트 종료 후 실행을 중지하세요.
클라우드 초기 계상액은 중지된 로컬 worker의 $1.410790200000008을 반영합니다.
SWA Standard, Functions, Storage, private endpoint/DNS와 로그·경고 비용은 별도입니다.
단가는 [모델별 단가 파일](../config/model-prices.json)의 유효기간 안에서만 사용합니다.
기간이 만료되면 출처를 확인하여 갱신해야 합니다.
상세 관측 결과와 권장 경고 기준은 [AOAI 운영 가이드](../AOAI_monitoring.md)를 참고합니다.

### 로컬 worker의 지속 실행

[부하 설정](../config/load-test.json)은 일반 호출과 짧은 고속 버스트를 분리합니다.
일반 호출은 세 모델에 입력 길이, 출력 상한 64/128/256, 호출 수 1/2를 순환 적용합니다.
버스트는 초당 30건, 2초간 최대 60건을 5분마다 시도하며 동시 요청은 최대 64개입니다.
실제 429 또는 인증 오류를 관측하면 새 요청을 중단하고 대기합니다. SDK 자동 재시도는 없습니다.
관측된 전송률은 상태 파일의 `lastBurst.peakStartsPerSecond`로 확인합니다.
설정한 RPS는 성공 처리량이나 Azure 보장 처리량이 아닙니다.

입력 probe에는 `violence, hate, self-harm` 범주 단어를 사용하는 예방 문장과
무해한 지침 무시 탐지 문장이 포함됩니다. 유해 지시문이나 원문 로그는 생성하지 않습니다.
실제 필터가 차단한 경우에만 live 차단으로 기록합니다. 범주 단어만으로 차단된다고 보장하지 않습니다.

```powershell
npm test
# 먼저 유한 canary로 설정/인증/telemetry를 검증합니다.
.\scripts\Start-LoadTest.ps1 -MaxWaves 5 -DemoScenarios
# 별도 지속 터미널에서 실행합니다. 기존 STOP marker가 있을 때만 -Resume을 추가합니다.
.\scripts\Start-LoadTest.ps1 -DemoScenarios
# worker가 시작된 후 다른 터미널에서 해당 worker 전용 경고를 구성합니다.
.\scripts\Set-DemoScenarioAlerts.ps1
# 종료 요청과 전용 demo rule 비활성화를 함께 실행합니다.
.\scripts\Stop-LoadTest.ps1
```

Node 22 이상이 PATH에 없다면 두 시작/설정 스크립트에 `-NodePath "<node.exe 절대 경로>"`를 전달합니다.
프로세스를 detached로 실행하면 채팅 종료 후에도 계속되지만 컴퓨터 종료 후 자동 재시작하지 않습니다.

| 경로 | 목적 | 반복/예산 |
| --- | --- | --- |
| `continuous-load`, live | 실제 토큰·지연·응답·차단·429 | $20/UTC일 보수적 예산, $14(70%)부터 비용 경고 |
| `continuous-demo-scenarios`, fixture | 입력/출력 차단, 429, 필터 실패, 503, usage 누락, 취소/미완료 | 매시간 3개 모델 × 9개 fixture, live 비용/호출 수에서 제외 |
| Demo guardrail / throttle log rule | fixture를 실제 Azure Monitor 경고로 평가하여 기존 이메일 경로 사용 | worker UUID 한정, 1분 평가/5분 창, stateful Fired/Resolved |
| Demo budget log rule | 현재 일일 예산 사용률 70% 이상 | live 보수적 추정, 실제 invoice 아님 |

기존 운영 규칙은 변경하지 않습니다. Demo 규칙 제목은 `SYNTHETIC DEMO` 또는 `DEMO LIVE BUDGET 70%`입니다.
fixture 알람이 Fired여도 Azure 모델의 실제 유해 입력 차단이나 native 429 발생 증거가 아닙니다.
비용 경고는 사용량 누락 시 예약액을 포함하고 $20 상한은 로그/경고 평가 등 Azure 전체 비용을 포함하지 않습니다.
예산 소진 시 worker는 유지하며 다음 UTC 날짜까지 호출을 대기합니다.
stateful 경고의 회복 메일도 올 수 있으며 inbox 수신 여부는 사용자가 확인해야 합니다.

로컬 상태는 `artifacts/loadtest/status.json`, 실제 요청은 날짜별 `.jsonl`,
fixture는 별도 `*-scenarios.jsonl`, 요약은 [dailyreport](../dailyreport.md)에 기록합니다.
STOP marker 확인은 최대 10초 heartbeat 주기이며 진행 중 스트림은 취소합니다.
`Set-DemoScenarioAlerts.ps1 -Disable`로 전용 규칙만 따로 비활성화할 수 있습니다.

## 단가 매핑 시연

[모델별 단가 파일](../config/model-prices.json)의 model/version/SKU key를 유지합니다.
현재 input/cached/output은 Azure 공식 retail 페이지/API로 검증된 USD per million 값입니다.
effectiveFrom/effectiveTo/source를 업데이트하고 status를 `verified`로 변경합니다.
계약 가격으로 바꾸면 그 출처를 별도로 명시합니다. 다른 모델의 가격으로 대체하지 마십시오.

[KQL 단가 mapping 예제](../queries/cost-rate-mapping.kql)는 leftouter lookup으로
가격 없는 deployment를 남기고 null 비용을 보여줍니다.
예제 datatable의 값을 실제 모델 단가로 오해하지 않도록 안내합니다.

## 실패 시 조사 순서

| 증상 | 확인 |
| --- | --- |
| 신규 배포 불가 | 모델 lifecycle/version/SKU/region/quota 및 ARM preflight |
| 401/403 | CLI tenant/subscription, principal, 역할 범위와 전파 |
| 400 | apiVersion, 모델 지원 파라미터, content_filter 여부 |
| 429 | 모델별 quota, burst, RPM/TPM 및 rate header |
| export 실패 | connection string, ingestion firewall/DNS, exporter error |
| 데이터 미수집 | run UUID, LAW 대상, ingestion lag, daily cap, telemetry flush |
| table not found | 첫 ingest 후 table 생성 여부, query scope |
| 비용 null | usage 존재, rate card status/key/유효기간/통화 |
| 알림 메일 없음 | Action Group receiver 및 전달 테스트 여부 |

SDK raw error body나 토큰을 문서/스크린샷에 복사하지 않습니다.
검증에 실패한 run은 성공 evidence로 재사용하지 않습니다.

## 종료와 재배포

데모 RG를 보존하면 log retention과 alert 평가 비용을 고려합니다.
데모가 끝난 뒤 실제 RG/구독을 확인하고 README의 scoped delete 명령을 실행하십시오.
삭제는 이 준비 작업에서 자동 실행하지 않습니다.
코드 변경은 `npm run build`로 로컬 CLI를 갱신합니다.
인프라 변경은 동일 설정으로 Deploy-Demo의 validate/what-if/Execute 순서를 따릅니다.
