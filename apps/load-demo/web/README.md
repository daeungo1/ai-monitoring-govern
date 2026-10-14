# 모델 부하 실험실

의존성이나 번들러 없이 `index.html`, `app.js`, `runner.js`, `styles.css`를 같은 출처의 API와 함께 제공합니다. 로그인 없는 공개 고객 데모이며 계정 조회나 로그인·로그아웃 흐름을 사용하지 않습니다. `staticwebapp.config.json`은 홈과 `/api/*`에 익명 접근을 허용하고 외부 스크립트·연결을 금지하는 CSP를 유지합니다. API도 공개 데모 접근을 허용하도록 별도 구성되어야 합니다.

앱의 **일일 비용 상한, 전역 단일 실행 제한, 서버 동시 요청 슬롯 제한, SYNTHETIC 15분 재실행 제한은 없습니다**. 여러 방문자의 실행은 run ID별로 독립 유지하며 다른 실행을 시작해도 기존 실행을 덮어쓰지 않습니다. 동시 요청 설정에 앱이 정한 최대값은 없으며 브라우저는 사용자가 지정한 목표 동시 요청 수와 RPS에 맞춰 발행합니다. 실제 Azure OpenAI quota와 Functions/Storage 처리 한계는 그대로 적용됩니다. 공개 데모이므로 사용량에 따라 비용이 계속 증가할 수 있습니다.

UTC 자정에 일일 비용 집계가 초기화됩니다. 표시되는 계상·예약 및 이벤트 비용은 관측용 추정치이며 실제 Azure 청구액이나 차단 기준이 아닙니다. 기존 ledger의 `$20` 및 `lastFixtureAt` 값은 더 이상 실행을 제한하지 않습니다. 새로고침은 이 브라우저가 저장한 실행만 복구하며 다른 방문자의 실행을 자동 선택하거나 부하를 자동 재개하지 않습니다.

## 실행 및 데이터

- API 설정에 제공된 모델만 선택하며 정수 비율 합계는 100%여야 합니다.
- 입력 반복은 브라우저에서 처리하며 반복된 전체 입력은 최대 3,500자이면서 UTF-8 3,500바이트 이하여야 합니다. 한글은 보통 글자당 3바이트이며 반복 사이 줄바꿈도 포함됩니다.
- 실행마다 호출 수가 유한합니다. 실제 발행 시각을 기준으로 요청 간격을 유지하여 지연 후 몰아서 발행하지 않습니다.
- 목표 RPS와 응답 완료 수 / 경과 시간인 관측 RPS는 별도입니다. 동시 요청 제한 때문에 실제 속도는 낮을 수 있습니다.
- 설정에서 제공하는 세 배포 이름(`gpt-6-luna`, `gpt-5.6-luna`, `gpt-5.6-terra`)을 대상 이름으로 그대로 표시합니다. 표시 이름으로 배포 이름을 대체하지 않습니다.
- 큰 카운터는 LIVE 완료·성공·429·차단 및 배포별 실제 요청 수만 표시합니다. 합성·미확인 결과는 실제 트래픽 카운터에서 제외합니다. 토큰·지연·비용 대시보드 대신 예산은 작은 안전장치 문구로 표시합니다.
- 실행 중에는 작은 점이 움직이며 `prefers-reduced-motion: reduce`에서는 정적으로 표시합니다.
- 중지·429·권한 오류 시 신규 요청을 멈추고 서버 중지를 요청합니다. 이미 전송한 요청은 취소한다고 주장하지 않고 완료를 기다립니다.
- SYNTHETIC 체크박스는 합성 입력/출력 차단 및 429 알림 재현입니다. 안전 어휘 프리셋 자체는 실제 차단을 보장하지 않습니다.
- 웹 합성 경고는 `web-demo-scenarios`의 모든 실행을 조회하므로 동시에 시작한 다른 실행이 경고 조회 대상을 덮어쓰지 않습니다. 기존 70% 비용 경고는 웹 경로에서 비활성화합니다. 알림 서비스 자체의 평가 주기와 반복 통지는 앱 재실행 제한과 별개입니다.
- 비용은 정제된 이벤트의 관측 추정치와 API의 오늘 계상·예약 예산을 따로 표시합니다. 실제 청구액이 아닙니다.
- 실행 생성 실패 시 HTTP 상태와 제한된 JSON `error` 문자열만 텍스트로 표시합니다. HTML 응답, 원문 프롬프트를 반사하는 오류, 객체, 과도한 길이·제어 문자는 표시하지 않으며 비JSON·네트워크 실패는 일반 안내로 처리합니다. 예산 부족 등의 오류를 로그인 문제로 바꾸지 않습니다.
- 최근 결과는 최대 100건의 허용된 메타데이터만 보관합니다. 입력·출력 원문은 결과 표, 로그, 저장소에 남기지 않습니다.
- `localStorage`에는 `load-demo-run-id`만 저장합니다. 새로고침하면 저장된 실행 ID로 상태만 복구하며 부하를 자동 재개하지 않습니다. 복구 지표는 서버의 보존 이벤트 기준이고 RPS는 새로 측정하지 않습니다.

## 검증

저장소 루트에서 Node 22로 실행합니다.

```powershell
node --test tests\web-runner.test.mjs
node --check apps\load-demo\web\app.js
```

브라우저 검증용 선택자:

- 공개 안내·상태: `#shared-budget-warning`, `#status`, `#error`, `#retry-button`
- 입력: `#preset`, `#prompt`, `#input-repeats`, `#output-tokens`, `#total-calls`, `#requests-per-second`, `#concurrency`
- 할당: `#allocations input[data-deployment]`, `#allocation-total`
- 실행: `#fixtures`, `#start-button`, `#stop-button`, `#mode-badge`
- 결과: `#live-traffic`, `#calls-metric`, `#success-count`, `#throttled-count`, `#blocked-count`, `#running-indicator`, `#synthetic-count`, `#inflight-metric`, `#observed-rps`, `#target-rps`, `#budget-metric`, `#observed-cost`, `#model-stats`, `#recent-results`

익명 설정 로딩과 실행 시도, 안전한 JSON 오류·HTTP 상태 표시 및 HTML/프롬프트 비노출은 Node 테스트에서 모의 API로 검증합니다. 시작 생성 중 중복 클릭 방지, 동시 요청과 요청 간격, 합성 표시, Azure 이벤트 429와 플랫폼 HTTP 429 구분, 중지 후 기존 요청 완료, 새로고침 후 신규 호출 없음, 100건 결과 제한, 작은 화면도 확인할 수 있습니다.
