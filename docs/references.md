---
title: 공식 참고 자료와 기존 delivery 연결
description: 2026-10-14 확인한 Azure Monitor, OpenAI, Content Safety 및 SDK 출처
ms.date: 2026-10-14
---

## 공식 문서

| 출처 | 활용 |
| --- | --- |
| [Azure OpenAI monitoring reference](https://learn.microsoft.com/en-us/azure/foundry/openai/monitor-openai-reference) | 정확한 REST metric 이름, 지원 SKU, legacy metric 주의 |
| [Monitor Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/monitor-openai) | native metrics/diagnostics/LAW 구조 |
| [Content filtering concepts](https://learn.microsoft.com/en-us/azure/foundry-classic/foundry-models/concepts/content-filter) | 입력/출력 필터와 API 처리 개념 |
| [Configure content filters](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/content-filters) | Medium 기본값, Prompt/Completion 별도 정책, 추가 필터 |
| [Performance and latency](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/latency) | throughput/latency, token 길이, client와 service 지표 구분 |
| [RAI policy ARM reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.cognitiveservices/2024-10-01/accounts/raipolicies) | IaC contentFilters/source/severityThreshold |
| [Diagnostic settings](https://learn.microsoft.com/en-us/azure/azure-monitor/data-collection/diagnostic-settings) | 수집 대상, 첫 데이터 이후 테이블, metric export 한계 |
| [OpenTelemetry configuration](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-configuration) | 최신 Microsoft distro 권장과 standalone exporter 지원 |
| [Cost Management data](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/understand-cost-mgt-data) | 후행 비용, 계약 및 invoice 차이 |
| [Azure OpenAI pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/) | 공식 단가 확인의 기준, 계약 가격은 별도 확인 |
| [Azure Retail Pricing API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) | public retail 단가 조회, meter 단위 확인 |
| [Foundry Models sold by Azure — Short context and long context](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure#gpt-56) | 롱컨텍스트는 요청 1건의 입력 토큰 수로 구분되며 출력 토큰과 무관. 임계 토큰 수는 가격 페이지에서 모델별 확인 |
| [Flex processing](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/flex-processing) | Flex는 Standard 대비 50%, 요청별 `service_tier` 선택, 응답의 처리 tier를 비용 로그에 기록 |
| [Workbook parameters](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-parameters) | `{param:escapejson}` 등 지원되는 형식. `{param:json}`은 지원 형식이 아님 |
| [Workbook tile visualizations](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-tile-visualizations) | tiles는 Tile Settings(제목·왼쪽·하단 열)가 필요하며 지표별 1행 결과에 맞음 |

문서의 classic/new Foundry URL이 변경되어 일부 추정 URL은 404였습니다.
위 목록은 실제 접근 가능한 canonical/공식 경로로 정리했습니다.
모델 가용성과 quota는 문서만이 아니라 현재 구독의 Azure CLI 및 ARM으로 확인합니다.

## 공식 저장소

| 저장소 | 활용 범위 |
| --- | --- |
| [Azure/azure-sdk-for-js exporter](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/monitor/monitor-opentelemetry-exporter) | 수동 tracer provider + Azure Monitor exporter 공식 패턴 |
| [Azure/azure-sdk-for-js identity](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/identity/identity) | Entra credential/token provider |
| [openai/openai-node](https://github.com/openai/openai-node) | AzureOpenAI, typed Chat Completions, retry 제한 |
| [Azure-Samples/azure-search-openai-demo](https://github.com/Azure-Samples/azure-search-openai-demo) | Azure 앱 운영 관측 참고, RAG 서비스는 이번 기본 배포에서 제외 |
| [Microsoft OpenTelemetry JS distro](https://github.com/microsoft/opentelemetry-distro-javascript) | 신규 앱의 최신 distro 권장 참고 |
| [ytthuan/FoundryMonitorDashboard](https://github.com/ytthuan/FoundryMonitorDashboard) | 실제 custom dashboard integration과 Overview/Platform/Tokenomics/Operations 정보 구조 |
| [Azure/agentops#343](https://github.com/Azure/agentops/issues/343) | Native Workbook sections/filters 참고, metric 이름/의미는 공식 reference로 정정 |

전체 샘플을 복제하지 않고 공식 SDK의 공개 인터페이스로 작은 API-only demo를 구성합니다.
자동 계측의 content capture를 통제하고 trace sampling과 비용 ledger를 분리하기 위해
지원되는 standalone Azure Monitor exporter를 의도적으로 사용합니다.
이는 최신 distro가 사용할 수 없다는 뜻이 아닙니다.

## 기존 고객 delivery

[daeungo1/enterprise-agent-observability](https://github.com/daeungo1/enterprise-agent-observability)의
OTel 기반 관측과 Azure Application Insights 연결 개념을 참고했습니다.

| 기존 delivery | 이번 데모 |
| --- | --- |
| LangGraph Teacher-Student/agent workflow | API 호출만, agent 없는 작은 CLI |
| OTel Collector + Langfuse + AKS | 수동 OTel exporter + Azure Monitor 표준 저장소 |
| 비동기 eval | 운영 관측과 분리 원칙만 유지, eval 점수 구현 아님 |
| 복수 관측 저장소 | LAW 중심 Workbook/Alerts |
| Content/eval delivery 경험 | 입력/출력 차단과 filter service failure의 명시적 구분 |

기존 저장소에 있던 고객 자료나 비공개 설정을 복사하지 않습니다.
최신 SDK 버전은 lockfile로 고정하고 제품 변경에 맞춰 가용성/정책/API version을 재검증합니다.
