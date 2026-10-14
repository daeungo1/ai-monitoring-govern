---
title: Hybrid 배포와 현재 접근 상태
description: 실제 Azure native/Grafana endpoints, 권한 경계, Custom UI 재인증 blocker와 재배포 순서
ms.date: 2026-10-14
---

## 배포된 관측 화면

| 표면 | 상태 | 진입 |
| --- | --- | --- |
| Portal shared Dashboard | 배포/read-back 완료, native MetricsChartPart 4개 | [열기](https://portal.azure.com/#view/Microsoft_Azure_Portal/Dashboard/armId/%2Fsubscriptions%2F2cf925b6-80cb-4567-abda-5ccd3010aab5%2FresourceGroups%2Frg-aoai-monitor-demo-20261014%2Fproviders%2FMicrosoft.Portal%2Fdashboards%2Faoaimon20261014d-dashboard) |
| Monitor Workbook | 21개 panel query 실제 실행, 8개 filter 구성 | [열기](https://portal.azure.com/#@/resource/subscriptions/2cf925b6-80cb-4567-abda-5ccd3010aab5/resourceGroups/rg-aoai-monitor-demo-20261014/providers/Microsoft.Insights/workbooks/26f11243-a304-50b5-8797-f3b95ce52949/workbook) |
| Managed Grafana | Standard / Grafana 12.4.8, 15개 실제 query status 200/data frame | [열기](https://aoaimon1014-grafana-c3hzd9fyeyd8cvcp.eus2.grafana.azure.com/d/aoai-streaming-hybrid) |
| Reference custom UI | 실제 upstream integration 빌드/테스트 및 Azure-ready ZIP 완료, 호스팅은 Entra 재인증 필요 | 아래 경계 확인 |

모든 링크는 demo tenant의 Entra login 및 적절한 RBAC가 필요합니다.
링크를 전달한다고 접근 권한이 부여되는 것은 아닙니다.
브라우저의 사용자 로그인/시각적 rendering과 API/KQL/data-source query 검증은 분리합니다.

## Native 배포

```powershell
npm run prices:refresh
npm run monitoring:build
.\scripts\Deploy-Demo.ps1 `
  -SubscriptionId "<subscription-id>" `
  -ResourceGroupName "<demo-rg>" -ResourcePrefix "<same-prefix>" `
  -Location "eastus2" -AlertEmail "<authorized-email>" -Execute
```

Portal shared Dashboard와 Workbook은 기본 Bicep에 포함합니다.
기간·deployment/model/streamtype/mode/run UUID를 filter합니다.
scope dropdown은 현재 배포의 구독/리소스이며 다중 구독 aggregator를 구현했다고 주장하지 않습니다.

## Managed Grafana 배포

[Grafana Bicep](../infra/managed-grafana.bicep)을 같은 demo RG에 배포합니다.
administratorId, resource names, region과 tags를 자신의 값으로 지정합니다.
Standard X1 기본 size와 Grafana 12를 사용합니다.
외부 snapshot/API key 및 zone redundancy는 비활성화합니다.
Identity는 LAW의 Log Analytics Reader와 OpenAI의 Monitoring Reader만 받습니다.

```powershell
node scripts/build-grafana.mjs
az grafana data-source create --resource-group "<demo-rg>" --name "<grafana-name>" `
  --definition "C:\repo\infra\grafana-datasource.json"
az grafana dashboard import --resource-group "<demo-rg>" --name "<grafana-name>" `
  --definition "C:\repo\infra\grafana-dashboard.json" --overwrite true
.\scripts\Verify-Grafana.ps1 -GrafanaName "<grafana-name>" -ResourceGroupName "<demo-rg>"
```

Import는 CLI에 직접 file path를 전달합니다.
Windows에서는 raw JSON/@ expansion 대신 UTF-8 파일 경로를 사용합니다.
Verification은 Grafana의 first-party Entra audience로 실제 `/api/ds/query`를 검증합니다.
현재 15개 panel 모두 status 200과 data frame 반환을 확인했습니다.

## Custom UI 인증 경계

Azure 호스팅 준비 중 전용 single-tenant Entra app registration을 생성했습니다.
이후 confidential credential 설정에서 Microsoft Graph가
`InteractionRequired / TokenCreatedWithOutdatedPolicies`를 반환했습니다.
인증을 비활성화해 공개하는 우회는 하지 않았습니다.
App Service에서 실제 custom UI가 공개 완료됐다고 보고하지 않습니다.

필요한 사용자 작업:

```powershell
az login --tenant "f6d04047-ac77-4fc2-941f-798ed4d54fcf" `
  --scope "https://graph.microsoft.com/.default"
```

이 작업은 현재 Azure authentication context를 재인증합니다.
사용자가 완료한 뒤 [Web hosting Bicep](../infra/hybrid-web.bicep)에
EasyAuth clientId/secret을 안전하게 전달하고 upstream integration을 zip deploy합니다.
Secret은 source/출력/log/ZIP에 저장하지 않고 보호된 단기 App Service setting에 둡니다.
Managed Identity는 LAW/OpenAI/Application Insights의 read-only scope만 사용합니다.
Custom UI의 상태는 [참고 integration](reference-dashboard.md)과 검증 기록을 확인하십시오.

## 정리와 추가 비용

Grafana는 유지하면 node 약 25 USD/730h + active user 6 USD/month가 발생합니다.
Custom UI용 Linux B1 plan을 생성하면 약 12.41 USD/730h가 추가됩니다.
모델·LAW·Alert·세금·계약 차액은 별도입니다.
전용 RG 삭제에는 Grafana도 포함됩니다. 기존/다른 고객 RG에는 실행하지 마십시오.
Entra app registration은 RG 밖의 리소스입니다. 불필요해지면 전용 appId를 확인하고,
별도 사용자 승인 후 삭제하십시오. 재인증 실패 시 생성된 등록도 정리 목록에 포함합니다.
