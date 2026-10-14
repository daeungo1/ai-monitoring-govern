---
title: Azure OpenAI Content Safety 설정과 차단 모니터링
description: 가드레일 기본 개념, RAI policy, API 차단 분류, Log Analytics 관측 한계
ms.date: 2026-10-14
---

## 가드레일의 의미

가드레일은 생성 모델과 별도로 입력과 출력을 분류하고 정책에 따라 허용/차단하는 통제입니다.
Azure OpenAI의 내장 content filtering은 Azure AI Content Safety로 지원됩니다.
이 필터는 정확성, 모든 prompt injection 방어, 모든 PII 제거를 보장하지 않습니다.
system prompt만으로 safety filter를 대체할 수 없습니다.

Hate, Sexual, Violence, Self-harm은 safe/low/medium/high severity를 사용합니다.
기본 Medium 임계치는 Medium과 High를 차단하고 Low와 Safe는 차단하지 않습니다.
Prompt와 Completion을 각각 설정해야 합니다.

## 이 데모의 정책

[RAI policy](../infra/resources.bicep)는 `demo-medium`을 생성하고 모든 모델 deployment에 연결합니다.
4개 harm category 각각에 Prompt/Completion, enabled=true, blocking=true,
severityThreshold=Medium을 명시합니다.

기반 정책은 `Microsoft.Default`입니다.
Prompt Shields direct attacks, protected material 등 추가 기능은 기본 정책과 실제 서비스의
현재 지원을 확인합니다. 이 데모가 각 추가 필터를 별도로 설정/테스트했다고 주장하지 않습니다.
필터를 낮추거나 끄는 구성은 기본 시연 경로에 넣지 않습니다.
필터 일부/전체 비활성화에는 제품 정책과 승인 제약이 있을 수 있습니다.
포털 명칭/메뉴는 classic/new Foundry에 따라 다르므로 실제 리소스에 연결된 정책을 확인합니다.

업무에서 오탐이 발생하면 category/severity와 정상 입력 코호트부터 분석합니다.
threshold를 완화하기 전에 입력 맥락, 사용 목적, 개인정보 처리, 사내 정책 승인을 검토합니다.
오탐 감소를 안전성 개선과 같은 것으로 취급하지 않습니다.

## 차단은 HTTP 오류만이 아닙니다

| 결과 | API 증거 | ledger outcome |
| --- | --- | --- |
| 입력 차단 | HTTP 400, error.code=content_filter, innererror | input_blocked |
| 출력 차단 | HTTP 200, finish_reason=content_filter 또는 filtered=true annotation | output_blocked |
| 필터 서비스 실패 | content_filter_results.error | filter_unavailable |
| annotation 미반환 | filter 결과 항목 없음 | filterObserved=false, 안전 검증됨이라고 표시하지 않음 |
| rate limit | HTTP 429 | throttled, content block과 별개 |
| 권한/파라미터 오류 | HTTP 4xx, content_filter code 아님 | client_error |

SDK가 반환한 에러 메시지 전체에는 사용자 원문이 포함될 수 있습니다.
로그에는 에러 객체를 그대로 serialize하지 않고 필요한 상태와 annotation만 사용합니다.
output이 잘려 반환되는 경우도 있으므로 응답 HTTP 성공을 안전 허용으로 간주하지 않습니다.
데모 CLI는 필터 실패/차단 또는 API 오류가 발생하면 nonzero exit code로 종료합니다.
응답 원문을 화면에도 출력하지 않습니다.

## 기존 Log Analytics에서 볼 수 있는 범위

Log Analytics를 이미 사용 중이라고 해서 모든 차단 detail이 수집된 것은 아닙니다.
진단 category 활성 여부, 대상 LAW, table mode, 지원 schema부터 확인하십시오.

[진단 discovery KQL](../queries/diagnostic-discovery.kql)은 category별 수집 존재를 확인합니다.
이 데모는 기본 `Audit + AllMetrics`만 수집하며,
native diagnostic 로그가 모든 요청의 상세 safety annotation을 가진다고 전제하지 않습니다.
`ContentFilterResults` 같은 category/table이 항상 존재한다고 가정하지 않습니다.

상세한 input/output 차단 조회는 호출부에서 API 결과를 관측해
workspace-based App Insights의 `AppDependencies.Properties`에 적재합니다.
[차단 KQL](../queries/content-filter.kql)이 deployment, outcome, status,
filter category/severity, usage 존재와 추정 비용을 연결합니다.
Application Insights 리소스 query scope의 legacy `dependencies/customDimensions`와
LAW workspace scope의 `AppDependencies/Properties`를 혼동하지 않습니다.

## 안전한 시연

재현 가능한 9개 fixture를 모델별로 replay합니다.
category/severity JSON envelope와 무해한 고정 chunk만 사용하며 유해 텍스트가 없습니다.
`demo.mode=fixture`를 강제하고 실제 비용·live 운영 지표 및 경고에서 제외합니다.

입력 차단 fixture는 실제 Azure가 해당 입력을 차단했다는 증거가 아닙니다.
출력 차단/429/필터 실패도 실제 장애를 유발하지 않고 관측 파이프라인을 검증합니다.
고객 승인된 red-team 또는 사내 안전 코호트로 실제 모델 필터 정책을 평가하려면
별도 테스트 계획·취급 권한·원문 보관 정책을 적용하십시오.

## 운영에서 추가로 결정할 정책

* filter_unavailable일 때 사용자에게 결과를 표시할지 중단할지 명확히 결정합니다.
* streaming에는 일부 출력 이후 차단, annotation 지연과 UX를 함께 다룹니다.
* direct prompt attack과 외부 문서의 indirect attack 방어를 구분합니다.
* 차단율뿐 아니라 annotation coverage, 필터 서비스 실패, 정상 업무 오탐을 관측합니다.
* 별도 Content Safety API의 severity 체계를 OpenAI filter annotation과 무조건 동일하게 매핑하지 않습니다.
* 원문 열람이 필요한 조사에는 제한된 저장소, 승인, 보존 기한, 접근 감사가 필요합니다.
