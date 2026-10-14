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
