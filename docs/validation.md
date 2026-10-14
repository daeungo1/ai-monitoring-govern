---
title: Demo 검증 기록
description: 실제 실행 증거와 재현 방법, 합성 시나리오 및 검증하지 않은 범위
ms.date: 2026-10-14
---

## 검증 원칙

배포 성공, API 성공, telemetry export 성공, LAW ingest 성공을 각각 구분합니다.
최종 증거는 실행 결과의 run UUID와 query 결과를 기준으로 업데이트합니다.
고객 presentation 전에 환경별로 재검증합니다.

## 로컬 검증

| 항목 | 확인된 결과 |
| --- | --- |
| Node | 별도 Node 22.23.3, 시스템 Node 20은 변경하지 않음 |
| Strict TypeScript | build 통과 |
| Unit/regression test | 초기 36개 후 local UI 제거 및 native/price guard 회귀 추가, 현재 root 39개 통과 |
| npm test | 지원 Node runtime에서 문서 명령 통과 |
| Offline/replay | 3개 모델 × 9개 fixture, raw content 없음 |
| PowerShell | 스크립트 parser, 인자 전달 회귀 테스트, 실제 deploy wrapper validate/what-if 통과 |
| JSON | 설정 및 lockfile 파싱 통과 |
| Bicep/ARM | 최종 세 모델 구성 build, ARM validate 통과 |
| what-if | 전용 demo RG의 신규 Create만 표시 |

## 실제 Azure 검증

검증일은 2026-10-14입니다. 현재 환경의 상세 resource ID와 증거 JSON은
git 제외된 `artifacts/settings.json`, `artifacts/azure-verification.json`,
`artifacts/email-test.json`에 유지합니다.

| 항목 | 실제 확인 |
| --- | --- |
| 배포 | 전용 demo RG, eastus2, 세 모델 각각 Succeeded |
| 실제 streaming API | 최신 run의 모델별 1회, 총 3회 HTTP 200 |
| final usage / TTFT / terminal | 최신 스트림 3/3 모두 수집 |
| 최신 run tokens | prompt 72, completion 143, cached 0 |
| fixture ingest | 최신 replay 27개, known usage 9 / unknown 18 |
| 비용 처리 | 공식 retail rate-version 반영 후 live 3/3 cost known, usage 누락은 null 유지 |
| 원문 금지 key | 선택한 실제/fixture run에서 0행 |
| Workbook query | 최신 native 21개 LAW/Resource Graph panel 실행 통과, model/run filter 결과 확인 |
| Alert query | deployed rule 7개 실제 LAW 실행 통과 |
| 운영 KQL | 별도 KQL 6개 실제 실행 통과 |
| ARM KQL validation | bootstrap skip=false로 최종 7개 log rule 배포/read-back |
| Native metrics | 실제 요청/토큰 신호 확인, Dashboard 6시간 scope에서 ledger와 9/150/179 일치 |
| 이메일 | 수신자 Enabled, 사용자가 주소 인증 완료, Azure LogAlert V2 test Email Succeeded / Complete |
| Portal Dashboard | 4 native metric charts + 3 Markdown parts 배포/read-back |
| Managed Grafana | Grafana 12.4.8 Standard, 15개 panel 모두 MI data-source query status 200/frame 반환 |
| Reference Dashboard | 실제 upstream integration 구현/검증 별도 기록, Azure 호스팅은 Graph 재인증 blocker |
| SVG | 아키텍처/streaming/Governance 3개 XML 파싱 및 metadata 검증 |

최신 가격 검증 streaming live run: `07f4e0df-251e-4b2d-af84-826943c0d0f5`.
최신 fixture replay run: `30970c53-2d3b-447f-8fdc-09e11605af01`.
Native 6시간 집계는 이전 smoke run까지 포함합니다. 특정 run의 token 수와 혼동하지 않습니다.

### 공식 가격 반영 후 streaming 측정값

| 모델 | TTFT ms | Total ms | Content chunks | Mean chunk gap ms | Prompt / completion |
| --- | --- | --- | --- | --- | --- |
| gpt-6-luna | 30,193 | 30,302 | 39 | 1.08 | 24 / 53 |
| gpt-5.6-luna | 1,888 | 1,950 | 39 | 1.58 | 24 / 42 |
| gpt-5.6-terra | 1,674 | 1,685 | 39 | 0.11 | 24 / 42 |

3회 합계 추정 retail 비용은 0.0006361 USD이며 실제 청구 invoice가 아닙니다.
각 요청 기록은 verified price source/date와 함께 저장됩니다.

각 1회이고 client 시간은 인증/네트워크를 포함합니다.
이 표는 관측이 작동한다는 증거이며 모델 성능 순위/SLO 보장/품질 benchmark가 아닙니다.
이전 gpt-6-luna streaming run 일부에서는 annotation이 미반환됐으며 false-safe로 치환하지 않았습니다.
최신 3회는 prompt annotation을 관측했습니다. 이를 completion safety 검증으로 확대 해석하지 않습니다.

## 재현

```powershell
npm test
.\scripts\Use-Demo.ps1 -Mode live -CountPerModel 1
.\scripts\Use-Demo.ps1 -Mode replay
.\scripts\Use-Demo.ps1 -Mode verify `
  -LiveRunId "<live-uuid>" -ReplayRunId "<replay-uuid>" -CountPerModel 1
```

실행 결과는 git 제외된 `artifacts`에 유지합니다.
검증 결과에는 토큰이나 connection string을 넣지 않습니다.

## 항상 별도로 남길 한계

* Content block/429/filter service failure는 안전한 envelope fixture의 관측 파이프라인 테스트입니다.
* 실제 모델의 harmful prompt/completion 차단, jailbreak 방어율, safety 품질은 검증하지 않습니다.
* 실제 streaming TTFT/final usage를 검증했지만 cancellation/incomplete는 fixture/단위 테스트입니다.
* 공식 retail 추정은 검증했지만 계약 가격 및 청구 invoice 대사는 검증하지 않습니다.
* 수신자 인증과 Azure 테스트 메일 결과, 실제 inbox 수신과 Alert rule firing을 각각 구분합니다.
* 작은 smoke test는 성능 benchmark나 SLO 보장으로 사용하지 않습니다.
* production private networking, failover, 장기 부하/retirement 대응은 별도 검증입니다.
* 실제 받은편지함 열람 및 운영 Alert rule의 Fired 이력은 확인하지 않습니다.
* Portal/Grafana 브라우저 rendering은 실제 사용자 Entra 로그인에서 추가 확인해야 합니다.
* 초기 localhost 앱은 사용자 조회 실패 보고 이후 제거했습니다.
  후속 단일 probe에서는 응답했으므로 일시적 실패의 정확한 원인은 단정하지 않습니다.
  Desktop CLI credential과 여러 upstream query를 묶은 로컬 앱에 운영 조회를 의존하지 않도록
  native 화면과 scoped MI Managed Grafana로 구조를 변경했습니다.
* Grafana 초기 검증의 인증 오류는 일반 URL audience 대신 공식 AMG first-party
  audience를 사용해 해결했습니다. CLI의 flat `--conditions`는 nested query 모델을 구성하지 못하므로
  실제 dashboard target JSON을 `/api/ds/query`로 전송해 검증했습니다.
* Reference custom UI의 Entra credential 설정은 CAE InteractionRequired로 차단됐습니다.
  재인증 전 public anonymous hosting으로 우회하지 않았습니다.

## 실제 참고 저장소 integration

Upstream `ytthuan/FoundryMonitorDashboard`의 MIT 코드를 사용하며 commit은
`2fe7fbe72591589139027fdf77a397ac7740cd00`입니다.
원래 LICENSE와 attribution을 source/배포 ZIP에 유지합니다.

* Build/typecheck/lint 통과, 최종 cost guard 이전 전체 suite 109개 통과.
* 최종 `price_scope_unsupported` 재계산 방지 회귀를 포함한 integration 16개 통과.
  Parent 실행에서도 4 test files / 16 tests 통과를 재확인했습니다.
* Prior local live smoke에서 overview/streaming/platform API HTTP 200과 실제 Azure 데이터를 확인했습니다.
  이 결과를 Azure hosted 검증이라고 보고하지 않습니다.
* 배포 ZIP SHA-256:
  `DFFEA00499378CE82339FB25D303C2BF61A24E5E46C8010AA099F92AD87B7F68`.
* Azure hosting은 user-authorized Entra 재인증과 EasyAuth 완료 전까지 차단 상태입니다.
