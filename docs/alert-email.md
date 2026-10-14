---
title: Azure Monitor 이메일 알림 시나리오
description: 수신자 인증, Common Alert Schema, 테스트 메일과 실제 경고 발생의 구분
ms.date: 2026-10-14
---

## 수신자 구성

고객이 승인한 이메일을 Action Group에 등록하고 Common Alert Schema를 사용합니다.
주소는 소스 코드의 기본값으로 넣지 않고 배포 파라미터로 전달합니다.
현재 사용자의 수신자 인증 완료는 확인됐습니다.
인증 완료는 주소 등록 확인이지 경고 메일 수신이나 규칙 firing 증거가 아닙니다.

```powershell
.\scripts\Deploy-Demo.ps1 `
  -SubscriptionId "<subscription-guid>" `
  -ResourceGroupName "<dedicated-demo-rg>" `
  -ResourcePrefix "<same-resource-prefix>" `
  -Location "eastus2" -AlertEmail "<authorized-email>" -Execute
```

기존 데모를 재배포할 때도 AlertEmail을 전달해야 이메일 설정이 유지됩니다.
파라미터를 생략하면 기본 IaC가 receiver 없는 Action Group으로 되돌릴 수 있습니다.
같은 구독, RG, prefix를 유지하고 what-if에서 알림 대상 변경을 확인하십시오.

## 재현 가능한 테스트 메일

```powershell
.\scripts\Test-AlertEmail.ps1 -EmailAddress "<authorized-email>"
```

이 명령은 Azure Monitor의 `logalertv2` 테스트 payload로 한 번의 이메일을 보냅니다.
OpenAI에 유해 요청을 보내거나 실제 장애를 만들지 않습니다.
테스트 결과는 git 제외된 `artifacts/email-test.json`에 남습니다.

| 단계 | 의미 | 확인 방법 |
| --- | --- | --- |
| 수신자 Enabled | 주소 인증/등록 상태 | Action Group read-back |
| Azure 테스트 작업 성공 | 테스트 notification 처리 완료 | Azure 결과의 receiver status |
| 실제 inbox 수신 | 메시지가 해당 mailbox에서 보임 | 사용자가 직접 받은편지함/정크메일 확인 |
| 실제 Alert firing | 규칙이 조건을 평가해 Fired 상태 | Alerts history 및 rule condition |
| 운영 incident | 실제 모델 호출의 장애/차단 | live ledger와 native 지표 |

Azure가 테스트를 성공 처리했다고 inbox 읽기까지 확인한 것으로 보고하지 않습니다.
테스트 메일 제목/본문은 Azure가 생성하므로 운영 장애 발생으로 해석하지 않습니다.

## 실제 운영 경고 연결

로그 규칙 7개와 네이티브 metric 규칙 1개가 같은 Action Group에 연결됩니다.
오류율, 429, p95는 모델별 최소 표본 조건을 사용합니다.
추정 spend는 단가가 configured인 요청만 평가합니다.
필터 실패는 `demo.mode=live`에서만 평가합니다.
fixture replay가 운영 Alert를 발생시키지 않도록 모든 log rule에 live 조건을 적용합니다.

최소 표본 20인 규칙에 1회 smoke test를 보내도 경고가 발생하지 않는 것이 정상입니다.
알림을 보여 주려고 production 임계치를 낮추거나 비용/실제 장애를 만들지 마십시오.
규칙 발생까지 시연하려면 승인된 별도 test rule, 특정 run UUID, 짧은 유효기간,
정리 절차를 가진 synthetic 전용 테스트를 설계합니다.
기본 제공 테스트 메일은 알림 경로 검증이며 이 test rule 시나리오를 대신했다고 주장하지 않습니다.

## 메일이 오지 않을 때

Action Group의 수신자 상태, email rate limit, tenant/메일 정책,
spam/quarantine, alert processing rule suppression, Fired/Resolved 상태를 확인합니다.
반복 테스트를 연속 발송하지 않습니다.
수신자 주소는 원문 telemetry와 분리해서 configuration 및 감사 영역으로 취급합니다.
