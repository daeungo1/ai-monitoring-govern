---
title: Azure Native 및 Hybrid 관측 화면
description: Workbook, Portal shared Dashboard, Managed Grafana와 참고 저장소 Dashboard의 역할 및 검증 경계
ms.date: 2026-10-14
---

## 화면 선택

![Hybrid 표준 아키텍처](diagrams/architecture.svg)

| 화면 | 권장 역할 | credential / 운영 |
| --- | --- | --- |
| Azure Monitor Workbook | 기본 운영 분석, 모델/기간/streaming/safety/cost drilldown | Portal Entra/RBAC, 별도 앱 없음 |
| Azure Portal shared Dashboard | 운영 landing, native 서비스 신호, Workbook 링크 | Portal native charts |
| Azure Managed Grafana | 지속 time-series 모니터링 및 공유 | Entra, Azure Monitor datasource Managed Identity |
| FoundryMonitorDashboard integration | 요청하신 저장소의 custom UX | 별도 Azure App Service, EasyAuth/MI, native와 함께 사용 |

초기 손으로 만든 localhost Dashboard는 제거했습니다.
Azure native 화면을 보기 위해 Node 서버를 시작할 필요가 없습니다.
Node CLI는 모델 호출과 sanitized telemetry를 생성하는 demo driver로만 사용합니다.

## 현재 Azure 화면

* [Portal 공유 Dashboard](https://portal.azure.com/#view/Microsoft_Azure_Portal/Dashboard/armId/%2Fsubscriptions%2F2cf925b6-80cb-4567-abda-5ccd3010aab5%2FresourceGroups%2Frg-aoai-monitor-demo-20261014%2Fproviders%2FMicrosoft.Portal%2Fdashboards%2Faoaimon20261014d-dashboard)
* [상세 Azure Workbook](https://portal.azure.com/#@/resource/subscriptions/2cf925b6-80cb-4567-abda-5ccd3010aab5/resourceGroups/rg-aoai-monitor-demo-20261014/providers/Microsoft.Insights/workbooks/26f11243-a304-50b5-8797-f3b95ce52949/workbook)
* [Managed Grafana · Streaming Hybrid](https://aoaimon1014-grafana-c3hzd9fyeyd8cvcp.eus2.grafana.azure.com/d/aoai-streaming-hybrid)

Portal에서 demo 구독 tenant로 로그인해야 합니다. 링크가 읽기 권한을 부여하지 않습니다.
shared Dashboard를 찾기 어려우면 리소스 그룹의 Microsoft.Portal/dashboard 리소스를 선택합니다.

## Workbook 상세 구성

현재 21개 query panel이며 8개 filter control을 제공합니다.

| 구획 | 데이터 |
| --- | --- |
| 운영 요약 | 요청/성공/input/output/추정USD tiles, 요청 추이, outcome, 모델별 p50/p90/p95/p99 |
| Streaming | client TTFT p50/p95 및 추이, total duration, chunk gap, final usage, 취소/incomplete |
| Operations | HTTP400/429/5xx, network 오류와 비율, 요청당 token, cache 비율 |
| 비용 | 모델별 token→USD, 기록 cost와 현재 Azure retail snapshot 재계산 구분, 가격 provenance |
| 가드레일 | source/category/severity, 입력/출력 차단/필터 실패, annotation coverage |
| Ledger / freshness | 최근 100개 요청, run UUID, stream 상태, ingestion p95 / 마지막 이벤트 |
| Native metrics | 실제 OpenAI 서비스 Requests/Prompt/Generated token export |
| Capacity | PAYG 현재 구성의 PTU/spillover N/A와 추가 도입 시 필요한 증거 |
| Alert / Governance | Resource Graph 기반 rule/config와 receiver 상태, 운영 통제 |

Filters: 기간, deployment, mode(live/fixture), run UUID, model, stream type,
현재 배포된 subscription와 OpenAI resource.
구독/리소스는 이 demo scope로 고정된 선택이며 임의 타구독 열람을 구현했다고 주장하지 않습니다.
실제 Portal 사용자 session이 LAW/Resource Graph 권한으로 각 query를 실행합니다.

## Portal Dashboard

7개 tile 중 4개는 Azure Monitor native MetricsChartPart입니다.

* AzureOpenAIRequests.
* ProcessedPromptTokens / GeneratedTokens.
* AzureOpenAITTLTInMS, client TTFT와 구분.
* TokenTransaction, 앞의 input/output과 다시 합산하지 않음.
* Header / 가격·정책 / Workbook·LAW·Action Group 링크.

모델별 client TTFT나 request safety detail은 Workbook의 요청별 ledger에서 확인합니다.
native 서비스 집계와 workbook live/fixture/run filter 범위는 같다고 전제하지 않습니다.

## Managed Grafana

Standard 기본 X1, Grafana 12, zone redundancy 비활성화로 구성합니다.
Essential은 신규 workspace에 사용할 수 없습니다.
Azure Monitor data source는 workspace의 system-assigned identity로 LAW/metrics를 읽습니다.
Grafana 화면 사용자는 별도의 Grafana Admin/Editor/Viewer 역할을 가져야 합니다.

[Grafana JSON](../infra/grafana-dashboard.json)은 15개 streaming/usage/cost/safety/ledger panel을 제공합니다.
기간 picker, deployment와 mode variable을 사용합니다.
사용자 지정 SMTP나 Grafana 자체 경고는 추가하지 않았습니다.
기존 Azure Monitor rules → Action Group → email 경로를 기본 알림 기준으로 유지합니다.
15개 Grafana panel의 data-source query를 실제 managed identity 경로로 실행해
각 status 200과 data frame 반환을 확인했습니다.
브라우저 사용자 session의 화면 rendering과 접근 권한 확인은 별도입니다.

## 참고 저장소 Hybrid

[FoundryMonitorDashboard](https://github.com/ytthuan/FoundryMonitorDashboard)의 실제 구현을
integration에 포함하며, agents/mock→live fallback 등 우리 scope와 다른 가정을 수정합니다.
Overview/Platform/Tokenomics/Models/Operations/Cost 구획은 두 화면의 공통 비교 기준입니다.
상세 구현/검증/호스팅 상태는 [참고 자료 적용 문서](agentops-dashboard-mapping.md)를 확인합니다.
실제 [integration 사용법](reference-dashboard.md)에는 production startup, 필요한 환경 변수,
compiled ZIP 및 인증 재개 절차가 있습니다.

## 데이터 신뢰성

가격 미설정/usage 미반환은 null입니다.
기록 rate-version cost와 과거 데이터의 current retail 재계산을 표시상 분리합니다.
fixture는 실제 사고·서비스차단·청구에서 제외합니다.
native와 ledger를 더하지 않으며 둘의 차이는 계측 범위/지연으로 조사합니다.
작은 smoke run의 p95/p99는 운영 benchmark나 SLO 보장이 아닙니다.
Portal UI rendering, datasource query, actual inbox 수신은 각각 별도 검증 단계입니다.
