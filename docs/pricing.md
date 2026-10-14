---
title: Azure 공식 가격 적용 및 검증
description: 축약 meter 이름, 공식 페이지 cross-check, context/SKU/tier 범위와 추정 비용 경계
ms.date: 2026-10-14
---

## 확인 결과

2026-10-14에 Azure Retail Prices API와 Azure OpenAI 공식 pricing page를 교차 확인했습니다.
지역은 East US 2, currency USD, SKU GlobalStandard, context ShortCo, processing Standard입니다.
단위는 USD per 1M tokens입니다.

| Model / version | Input | Cached input | Output | Cache write |
| --- | --- | --- | --- | --- |
| gpt-6-luna / 2026-09-22 | 0.10 | 0.01 | 0.50 | 0.125 |
| gpt-5.6-luna / 2026-07-09 | 0.20 | 0.02 | 1.20 | 0.25 |
| gpt-5.6-terra / 2026-07-09 | 2.00 | 0.20 | 12.00 | 2.50 |

이전에는 `gpt-6-luna`처럼 모델 이름을 meterName에서 그대로 찾았기 때문에 잘못 미조회로
판단했습니다. 실제 meter naming은 `6-luna ShortCo Inp Std Gl`와
`5.6 luna/terra ShortCo ...`입니다. 공식 페이지의 `$-`는 동적 formatting placeholder이고,
HTML `data-amount.regional.us-east-2`에는 동일한 가격이 들어 있습니다.

## 재현과 출처

```powershell
npm run prices:refresh
npm run monitoring:build
```

[갱신 스크립트](../scripts/azure-prices.mjs)는 API paging과 정확한 SKU/meter/unit/region을
확인한 다음 공식 페이지의 첫 Standard 가격 열을 대조합니다.
Flex/PP/LongCo의 값으로 조용히 대체하지 않습니다.
Missing/duplicate/mismatched meter 또는 두 출처 불일치는 실패합니다.

[모델별 card](../config/model-prices.json)에는 meter ID, meter effective date,
조회일, 실제 단가와 출처가 들어 있습니다.
[증거](../config/azure-price-evidence.json)는 API URL과 페이지 label/가격 cross-check를 제공합니다.
모델 version은 deployment key이고 공개 meter 자체가 version별 계약 요금을 제공하는 것은 아닙니다.

## 적용 범위

현재 demo driver는 짧은 text-only prompt와 128-token completion 상한만 사용합니다.
Price card는 보수적으로 prompt 4,096 token 이하 범위에만 적용하며,
이 숫자를 모델의 공식 short/long 경계라고 주장하지 않습니다.
Long context 경계와 pricing tier를 사용하는 운영 workload는 별도 정책/key가 필요합니다.

Cache-write 단가는 확인해 보관하지만 현재 Chat Completions driver는 cache-write billing을
구현하지 않습니다. Cache creation/write tokens가 반환되면 ordinary input으로 덮어 계산하지 않고
cost unknown으로 처리합니다. Audio/image/tool/priority/flex/batch/PTU는 기본 수식 밖입니다.
Cached metadata가 없으면 input 전부를 uncached로 처리한 상한 성격의 추정임을 설명합니다.

## Ledger와 Workbook 재계산

새 호출은 verified rate-version으로 요청별 추정 USD를 기록합니다.
과거 unconfigured ledger 행의 null cost를 수정하지 않습니다.
Workbook/Grafana는 known usage에 대해 current snapshot을 적용할 수 있으며
`recorded rate version`과 `current Azure retail snapshot reprice`를 명시적으로 구분합니다.
가격·기간·모델 scope 밖의 행은 null입니다.
실제 invoice/계약 가격, 세금, 크레딧 및 비용 반영 지연과 대사해야 합니다.

## 시각화 서비스 비용

동일 API 조회에서 Managed Grafana는 `Azure Grafana Service`의
Standard Node 0.034246 USD/hour, Standard User 6 USD/month였습니다.
730시간 node 약 25 USD와 active user 비용이 발생합니다.
Zone redundancy meter는 0.041095 USD/hour이며 현재 비활성화합니다.
신규 Essential 생성은 지원되지 않습니다.

Linux App Service B1은 0.017 USD/hour, 730시간 약 12.41 USD입니다.
Workbook/Portal Dashboard는 별도 hosted compute가 없지만 LAW 수집/조회 및 Alert 평가,
모델 호출 비용은 별도로 존재합니다.
데모 종료 시 Grafana와 App Service를 포함한 dedicated RG 정리를 권장합니다.
