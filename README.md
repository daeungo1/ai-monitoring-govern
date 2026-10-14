---
title: Azure OpenAI API Monitoring Demo
description: Azure Monitor 기반 다중 모델 사용량, 추정 비용, Content Filter 관측 데모
ms.date: 2026-10-14
---

## 목적

에이전트를 사용하지 않는 Azure OpenAI streaming API 고객을 위한 고객 기술 지원용 데모입니다.
Azure Monitor 네이티브 메트릭과 호출부 OpenTelemetry를 함께 사용합니다.
프롬프트, 응답 원문, API 키를 관측 데이터에 저장하지 않습니다.

| 고객 요구 | 구현 |
| --- | --- |
| 핵심 메트릭과 경고 기준 | 네이티브 메트릭 설명, 모델별 오류/429/p95 및 비용 경고 |
| 빠른 토큰/비용 관측 | API usage 기반 요청별 ledger, 캐시 구분, 단가 버전 관리 |
| Content Safety 기초/설정 | 입력/출력 Medium 정책, API 결과 기반 필터 관측 |
| Log Analytics 차단 조회 | 입력 400과 출력 200 차단을 별도로 기록하는 KQL |
| 여러 모델 비교 | `gpt-6-luna`, `gpt-5.6-luna`, `gpt-5.6-terra` 별도 배포 |
| 재현 가능한 데모 | Bicep, PowerShell, streaming/offline/replay, 상세 Dashboard와 검증 기록 |
| AI Observability Governance | control/RACI/데이터 계약/release gate/SVG, AKS 제외 |

> [!IMPORTANT]
> 모델 토큰 단가는 확인하지 못한 경우 `unconfigured`이며 비용은 `null`입니다.
> 현재 세 모델은 **Azure Retail Prices API와 공식 가격 페이지를 교차 확인한 단가**를 반영했습니다.
> GlobalStandard / Short context / USD per 1M이며 이 데모의 prompt 4,096 token 이하 범위에 적용합니다.
> 계약 가격·청구 비용과 다릅니다. 비용 계산 예제의 illustrative rate card는 별도로 구분합니다.
> 안전 필터 차단 시연은 유해 문장 없는 fixture이며 실제 서비스 차단 테스트와 구분합니다.

## 아키텍처

![표준 AI Observability 아키텍처](docs/diagrams/architecture.svg)

Cost Management 일별 대사는 운영 권장 설계이며 자동 대사 커넥터는 이 데모에 포함하지 않습니다.
APIM, AKS, Langfuse, Grafana, agent framework는 기본 배포에 필요하지 않습니다.

## 문서

* [표준 아키텍처와 보안 경계](docs/architecture.md)
* [AI Observability Governance](docs/governance.md)
* [Streaming 지표와 종료·취소 처리](docs/streaming.md)
* [Azure Native / Hybrid Dashboard 선택과 사용](docs/dashboard.md)
* [참고 저장소·AgentOps issue 적용 판단](docs/agentops-dashboard-mapping.md)
* [공식 Azure 가격과 적용 범위](docs/pricing.md)
* [Hybrid 배포와 현재 접근 상태](docs/hybrid-deployment.md)
* [실제 참고 저장소 Dashboard integration](docs/reference-dashboard.md)
* [메트릭, 토큰 비용, Alert 운영 가이드](docs/monitoring-guide.md)
* [Content Safety 설정과 차단 관측](docs/content-safety.md)
* [15분 고객 데모 Runbook](docs/demo-runbook.md)
* [이메일 알림 시나리오](docs/alert-email.md)
* [검증 결과와 미검증 범위](docs/validation.md)
* [공식 출처와 기존 delivery 활용 기준](docs/references.md)

## 빠른 시작

Windows PowerShell 7, Node.js 22 이상, Azure CLI, Bicep가 필요합니다.
모든 명령은 저장소 루트에서 실행합니다. Azure CLI 인증은 `az login`으로 준비합니다.
권한은 리소스 생성 및 OpenAI 리소스 범위 RBAC 생성이 가능해야 합니다.
모델별 quota와 가용 버전은 배포 직전에 다시 확인합니다.

```powershell
npm ci
npm test
npm run demo:offline
```

Offline은 모델 호출·Azure export 없이 세 모델별 9개 fixture와 독립적인 비용 수학 예제를 실행합니다.

## 현재 검증 요약

실제 streaming 3개 모델, fixture 27개, Azure native Workbook·Portal dashboard,
7개 Alert와 운영 KQL을 구성했습니다. 최종 query/검증 수는 검증 기록을 확인하십시오.
사용자 지정 이메일 수신자와 Azure test notification의 발송 성공을 확인했습니다.
공식 retail 단가는 확인했지만 계약 단가, 실제 inbox 수신, harmful-input 차단율과 production 보안 완료는
검증했다고 주장하지 않습니다. 상세 수치/범위는 [검증 기록](docs/validation.md)에 있습니다.

## Azure 배포와 시연

```powershell
# 먼저 validate와 what-if만 실행합니다.
.\scripts\Deploy-Demo.ps1 `
  -SubscriptionId "<subscription-guid>" `
  -ResourceGroupName "rg-aoai-monitor-demo" `
  -ResourcePrefix "<globallyuniqueprefix>" `
  -Location "eastus2"

# 검토 후 -Execute를 추가합니다. 실제 과금 리소스를 생성합니다.
.\scripts\Deploy-Demo.ps1 `
  -SubscriptionId "<subscription-guid>" `
  -ResourceGroupName "rg-aoai-monitor-demo" `
  -ResourcePrefix "<globallyuniqueprefix>" `
  -Location "eastus2" -Execute

.\scripts\Use-Demo.ps1 -Mode live -CountPerModel 1
.\scripts\Use-Demo.ps1 -Mode replay
```

각 실행의 마지막 줄에 출력되는 run UUID를 기록합니다.
메일 경로 시연은 배포 시 `-AlertEmail "<authorized-email>"`을 추가하고
`.\scripts\Test-AlertEmail.ps1 -EmailAddress "<authorized-email>"`로 한 번 테스트합니다.
수신자 인증, Azure 발송 결과, 실제 inbox 수신을 별도 확인합니다.

```powershell
.\scripts\Use-Demo.ps1 -Mode verify `
  -LiveRunId "<live-run-uuid>" -ReplayRunId "<replay-run-uuid>" `
  -CountPerModel 1
```

모델 하나만 실행하려면 `-Deployments "gpt-5.6-terra"`를 추가하고 verify에도 같은 선택을 적용합니다.
단일 실행에서 같은 safe counting 메시지와 출력 상한으로 모델들을 streaming 순차 호출합니다.
작은 smoke test의 지연값은 모델 품질/성능 벤치마크가 아닙니다.

관측은 Azure Portal의 shared Dashboard와 Workbook에서 시작합니다.
[화면 링크와 사용법](docs/dashboard.md)을 확인하십시오.
기존 localhost web app은 제거했으며 native 화면을 위한 로컬 서버는 필요하지 않습니다.
Managed Grafana와 참고 저장소 Dashboard는 Hybrid 비교 경로입니다.
참고 저장소의 실제 React/Fastify 코드는 [integration](integrations/foundry-dashboard)에 포함했습니다.
MIT license와 upstream commit을 보존하고 API-only LAW adapter, streaming/ledger와 null 비용을 반영했습니다.
Native/Grafana는 배포·조회 검증됐지만 custom UI의 Azure 호스팅은 Microsoft Graph 재인증에
막혀 있습니다. 인증을 끈 공개 호스팅으로 우회하지 않았습니다.

## 공식 가격 갱신

| 모델 | Input | Cached input | Output | Cache write |
| --- | --- | --- | --- | --- |
| gpt-6-luna | $0.10 | $0.01 | $0.50 | $0.125 |
| gpt-5.6-luna | $0.20 | $0.02 | $1.20 | $0.25 |
| gpt-5.6-terra | $2.00 | $0.20 | $12.00 | $2.50 |

단위는 USD per 1M tokens, East US 2 / Global Standard / Short context입니다.
Cache write meter는 기록하되 현재 driver의 별도 cache-write billing은 구현하지 않습니다.
cache-write token이 반환되면 기본 input 수식으로 숨겨 계산하지 않고 unknown으로 처리합니다.

```powershell
npm run prices:refresh
npm run monitoring:build
```

API meter 약어(`ShortCo / Inp / Cd Inp / Cd Wr / Opt / Std Gl`)와 공식 HTML `data-amount`를
대조합니다. [가격 증거](config/azure-price-evidence.json)에 출처와 확인일이 저장됩니다.
Workbook에는 과거 null cost의 current snapshot 재계산과 원래 기록 cost를 별도로 표시합니다.

## 설정과 데이터

* [모델 설정](config/models.json)은 배포명, 실제 모델명, 버전, SKU, quota capacity의 단일 기준입니다.
* [모델별 단가](config/model-prices.json)는 실제 호출 비용 계산용입니다.
* [Managed Grafana IaC](infra/managed-grafana.bicep)와 [Hybrid web hosting IaC](infra/hybrid-web.bicep)는 추가 표면입니다.
* [독립적인 단가 예제](config/prices.json)는 비용 수식 시연에만 사용합니다.
* [KQL](queries)은 고객이 기존 Log Analytics에 맞춰 가져갈 수 있습니다.
* [Bicep](infra/main.bicep)은 별도 리소스 그룹을 포함해 구독 범위로 배포합니다.
* [테스트](tests)는 원문 없는 응답 envelope, 캐시 계산, 누락 usage, 단가와 모델 선택을 검증합니다.

실행 결과와 설정은 git 제외된 `artifacts` 디렉터리에 저장합니다.
Application Insights connection string은 실행 프로세스에만 로드합니다.
기본 샘플은 Entra user 인증이고 API key 인증은 비활성화합니다.

## 비용과 정리

모델 PAYG 호출, Log Analytics 수집, 7개 log alert와 1개 metric alert 평가에 비용이 발생할 수 있습니다.
Managed Grafana Standard는 node 약 25 USD/730h + active user 약 6 USD/월입니다.
Reference Dashboard를 Azure Linux B1에 호스팅하면 약 12.41 USD/730h가 추가됩니다.
실제 계약/세금/LAW/모델 사용량은 별도이며 상세 출처는 가격 문서에 있습니다.
Workbook만 표시한다고 추가 hosted compute가 생기지는 않습니다.
LAW의 1 GB/day cap은 비용 제한의 보조 장치이며 청구 hard cap도 수집 보장도 아닙니다.
AlertEmail을 지정하지 않으면 규칙은 생성되지만 email 알림 수신자는 없습니다.

데모 종료 후 별도 리소스 그룹의 이름과 구독을 확인하고 삭제합니다.
다른 고객/운영 리소스 그룹에는 실행하지 마십시오.

```powershell
az group delete --subscription "<subscription-guid>" `
  --name "rg-aoai-monitor-demo" --yes --no-wait
```

GitHub 원격 저장소 생성, push, CI/CD 자동 배포는 수행하지 않습니다.
공개 전에는 문서의 환경 식별자와 `artifacts`, `.env`, credential 파일 제외 여부를 검토합니다.
