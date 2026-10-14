---
title: AgentOps 및 Foundry Dashboard 적용 판단
description: 사용자 참고 자료의 화면 구성과 metric 제안을 검토한 적용/비적용 근거
ms.date: 2026-10-14
---

## 참고 자료

* [ytthuan/FoundryMonitorDashboard](https://github.com/ytthuan/FoundryMonitorDashboard)는
  React/Fastify의 별도 custom 앱입니다. Azure native dashboard 그 자체는 아닙니다.
  Overview, Platform, Tokenomics, Models, Operations, Cost의 정보 구조를 Hybrid에 적용합니다.
  Agent 화면은 API-only 고객에게 N/A로 처리합니다.
  실제 integration은 upstream commit `2fe7fbe72591589139027fdf77a397ac7740cd00`을 기반으로 하며
  원래 MIT license/copyright를 보존합니다. App Service용 컴파일된 패키지를 제공합니다.
* [Azure/agentops#343](https://github.com/Azure/agentops/issues/343)은 Workbook/Portal dashboard
  제안 issue입니다. 공식 metric reference를 대체하는 구현 명세나 서비스 보장이 아닙니다.

## 적용 매핑

| 참고 요구 | 적용 | 주의 |
| --- | --- | --- |
| Overview / Platform | Portal native metric 차트 + Workbook KPI | native 사용량과 계측 ledger 범위를 구분 |
| Tokenomics / Models | input/output/cached, 모델별 token/request 및 캐시 비율 | 누락 usage 분모를 구분 |
| Operations | 모델별 p50/p90/p95/p99, HTTP 400/429/5xx, network error | 평균 latency로 percentile을 만들지 않음 |
| Cost | 공식 Azure meter와 페이지 대조, 기록 rate와 snapshot reprice 별도 | 계약/청구 실제 비용과 구분 |
| Streaming | TTFT, total duration, chunk gap, final usage, 취소/incomplete | chunk gap ≠ TBT |
| PTU / Spillover | 현재 GlobalStandard PAYG는 N/A | 실제 PTU나 spillover 라우팅을 배포하지 않음 |
| 필터 | 별도 safety outcome/annotation/coverage | agents 없어도 input/output 필터 관측 필요 |
| Filters | 기간, deployment, model, stream type, mode, run UUID | 구독/리소스는 현재 demo 범위를 명시 |
| Governance | Entra, scoped MI, 원문 최소화, null, 승인/대사/incident | demo를 production compliance로 보고하지 않음 |

## 그대로 채택하지 않은 제안

Issue의 `BlockedCalls`, `TotalCalls`, legacy `Latency` 등을 OpenAI 전용 운영 지표와 혼용하지
않습니다. Azure OpenAI용 `AzureOpenAIRequests`, `ProcessedPromptTokens`, `GeneratedTokens`,
지원되는 OpenAI latency metrics를 실제 리소스 정의에서 확인합니다.
`InputTokens/OutputTokens/TotalTokens`가 모든 OpenAI 계정에 있다는 가정도 하지 않습니다.

Token 사용량에서 `Ratelimit`를 빼서 spillover라고 계산하지 않습니다.
Quota admission 예약과 실제 billable token은 다르며, spillover는 실제 route 및
`IsSpillover` 같은 지원 dimension으로 확인해야 합니다.
PTU%를 token과 같은 y축으로 임의 배율 합산하지 않습니다.
UtilizationV2의 Logs export 지원 제한도 고려합니다.

RequestResponse/Trace 등 원문 노출 위험이 있는 diagnostic category를 issue 설명만 보고
활성화하지 않습니다. 현재 metadata/metric + sanitized OTel contract를 유지합니다.
추가 usage diagnostics는 실제 schema/privacy 검토 후 별도 승인으로 확장합니다.

## Azure 시각화 선택

| 표면 | 역할 | 비용/운영 |
| --- | --- | --- |
| Monitor Workbook | 모델/기간 필터, KQL drilldown, governance 기본 분석 | 별도 앱 hosting 없음, LAW 비용 |
| Portal shared Dashboard | Native Requests/Tokens/Latency와 Workbook 링크 | 별도 compute 없음 |
| Managed Grafana Standard X1 | 지속 time-series 관측, Azure Monitor datasource/Entra/MI | 현재 retail node 약 25 USD/730h + active user 6 USD/월 |
| Azure-hosted reference dashboard | 요청한 저장소의 custom UX와 native/ledger 비교 | Linux B1 약 12.41 USD/730h, 별도 앱 운영 |

Grafana Essential은 신규 생성이 중단된 상태이므로 사용하지 않습니다.
현재 데모는 Standard 기본 X1, zone redundancy 비활성화로 구성합니다.
세금·계약 할인·LAW/모델 비용은 별도입니다. 배포 후 보존하면 비용이 계속 발생합니다.
Custom Dashboard는 코드/패키지/로컬 live adapter 검증과 Azure hosted 검증을 구분합니다.
Azure host 공개는 Entra 재인증과 tenant/user 제한 EasyAuth 완료 전까지 보류합니다.
