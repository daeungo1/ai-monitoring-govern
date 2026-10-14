export interface DailyReportGroup {
  profile: string;
  model: string;
  attempts: number;
  successes: number;
  inputTokens: number;
  outputTokens: number;
  ttftP95Ms: number | null;
  estimatedUsd: number | null;
  unknownCost: number;
}

export interface DailyReportInput {
  day: string;
  timestamp: string;
  workerId: string;
  pid: number;
  status: string;
  active: number;
  summary: {
    attempts: number; successes: number; knownUsage: number; unknownCost: number;
    inputTokens: number; outputTokens: number; estimatedUsd: number | null;
  };
  budgetAccountedUsd: number;
  dailyBudgetUsd: number;
  groups: DailyReportGroup[];
  scenarioCycles: number;
  syntheticEvents: number;
  scenarioInterval: number | null | undefined;
  lastBurst: unknown;
}

const FENCE = "```";
const percent = (part: number, whole: number): string => whole === 0 ? "N/A" : `${(100 * part / whole).toFixed(1)}%`;
const usd = (value: number | null): string => value === null ? "미산정" : value.toFixed(6);

export function renderDailyReport(input: DailyReportInput): string {
  const { summary } = input;
  const successRate = percent(summary.successes, summary.attempts);
  const usageRate = percent(summary.knownUsage, summary.attempts);
  const rows = input.groups.map(g =>
    `| ${g.profile} | ${g.model} | ${g.attempts} | ${g.successes} | ${g.inputTokens} | ${g.outputTokens} | ${g.ttftP95Ms ?? "N/A"} | ${usd(g.estimatedUsd)} | ${g.unknownCost} |`);
  if (rows.length === 0) rows.push("| 아직 측정 없음 | - | 0 | 0 | - | - | - | - | - |");
  const warning = (input.dailyBudgetUsd * 0.7).toFixed(2);

  return [
    "---",
    "title: AI Monitoring Daily Report",
    "description: Azure OpenAI API 모니터링 요건별 답과 지속 streaming 부하의 실제 측정 요약",
    `ms.date: ${input.day}`,
    "---",
    "",
    "## 이 문서는 무엇인가요",
    "",
    "Azure OpenAI를 **API로 직접 호출**(에이전트 기능 없음)하는 환경에서 사용량·비용·오류·가드레일을 어떻게 관측하는지,",
    "지속 부하 Worker로 실제 검증한 **일일 요약**입니다. Worker가 실행되는 동안 자동으로 갱신됩니다.",
    "프롬프트·응답 원문과 API 키는 저장하지 않습니다. 처음 보신다면 [README](README.md)에서 전체 그림을 먼저 확인하세요.",
    "",
    "## 고객 요건과 이 보고서의 답",
    "",
    "**1. 효율적인 AI 사용량 모니터링** — (a) 핵심 메트릭 가이드와 Alert 임계치, (b) 실시간 비용/토큰 모니터링 조언, (c) 추가 운영 팁",
    "",
    "**2. 가드레일(Content Safety) 모니터링 및 설정** — (a) 개념과 설정 가이드, (b) 차단된 요청을 Log Analytics로 볼 수 있는지",
    "",
    "| 고객 요건 | 이 보고서에서 볼 값 | 답 | 자세히 |",
    "| --- | --- | --- | --- |",
    `| 핵심 메트릭과 Alert 임계치 | 성공률 ${successRate} · burst 프로파일의 429 | 요청 수·429·오류율·지연(p95)·토큰을 모델별로 봅니다. 시작점 예: 모델별 15분·20건 이상에서 오류/429 5% 이상, 총 소요 p95 5초 초과. 고객 SLO에 맞춰 보정합니다. | [메트릭·경고 가이드](docs/monitoring-guide.md) |`,
    `| 실시간 비용·토큰 | 입력 ${summary.inputTokens} · 출력 ${summary.outputTokens} 토큰 · 추정 USD ${usd(summary.estimatedUsd)} · usage 확보율 ${usageRate} | Azure 비용 반영(약 1일 지연)을 기다리지 않고 응답 usage × 단가표로 요청마다 계산합니다. 메트릭 합계 × 단가는 근사치입니다. | [가격 문서](docs/pricing.md) |`,
    `| 추가 운영 팁 | 비용 미산정 ${summary.unknownCost}건 | 429 Retry-After와 backoff, max_completion_tokens 상한, 월 Budget alert, 모델 버전·retirement 관리, ingestion 지연·usage coverage 경고를 권장합니다. | [메트릭·경고 가이드](docs/monitoring-guide.md) |`,
    "| 가드레일 개념·설정 | safety 프로파일 행(아래 표) | 입력과 출력을 각각 심각도 임계치(Medium)로 필터링합니다. 입력 차단은 HTTP 400, 출력 차단은 HTTP 200 + finish_reason으로 구분합니다. | [Content Safety 문서](docs/content-safety.md) |",
    "| 차단 요청의 Log Analytics 조회 | 아래 KQL | **가능합니다.** 다만 호출부에서 응답을 계측해 AppDependencies에 적재해야 category·severity 상세가 남습니다. 기본 진단 로그만으로는 보장되지 않습니다. | [차단 KQL](queries/content-filter.kql) |",
    "",
    "차단된 요청을 Log Analytics에서 세어 보는 최소 쿼리입니다.",
    "",
    `${FENCE}kusto`,
    "AppDependencies",
    "| where TimeGenerated > ago(24h)",
    '| where Properties["telemetry.kind"] == "aoai.request" and Properties["demo.mode"] == "live"',
    '| extend Outcome = tostring(Properties["aoai.outcome"]), Deployment = tostring(Properties["aoai.deployment"])',
    '| where Outcome in ("input_blocked", "output_blocked", "filter_unavailable")',
    "| summarize Requests = count() by Outcome, Deployment",
    FENCE,
    "",
    "## 오늘의 실행 상태",
    "",
    `* 갱신 UTC: ${input.timestamp}`,
    `* Worker: ${input.workerId}; PID ${input.pid}; 상태 ${input.status}; 동시 실행 ${input.active}`,
    `* 오늘 호출 ${summary.attempts}, 성공 ${summary.successes} (성공률 ${successRate}), usage 확보 ${summary.knownUsage} (${usageRate}), 비용 미산정 ${summary.unknownCost}`,
    `* 입력 ${summary.inputTokens} / 출력 ${summary.outputTokens} 토큰; 추정 USD ${usd(summary.estimatedUsd)}`,
    `* 보수적 일일 예산 사용 ${input.budgetAccountedUsd.toFixed(6)} / ${input.dailyBudgetUsd} USD (미완료·usage 누락은 reservation 적용)`,
    "",
    "## 프로파일별 측정",
    "",
    "| Profile | Model | Calls | Success | Input tokens | Output tokens | TTFT p95 ms | Estimated USD | Unknown cost |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "표 읽는 법:",
    "",
    "* **Calls / Success**: 호출 수와 성공 수입니다. 429나 타임아웃은 성공이 아닙니다.",
    "* **Unknown cost**: 토큰 usage를 받지 못한 요청 수입니다. 이 요청의 비용은 0이 아니라 미산정입니다.",
    "* **TTFT p95**: 첫 번째 화면 표시 가능한 내용(visible content)까지의 클라이언트 시간입니다. N/A는 표본이 없다는 뜻이며, 작은 표본의 percentile은 SLO 벤치마크가 아닙니다.",
    "* **short / medium / longer**: 출력 길이를 달리한 일반 호출입니다. **burst-30rps**는 초당 30건의 순간 부하로 429(스로틀링) 관측을 확인합니다.",
    "* **safety-vocabulary / instruction-override**: 유해 콘텐츠가 아닌 안전 어휘와 무해한 지시 무시 문구로 가드레일 관측 경로를 확인합니다.",
    "",
    "## 비용은 이렇게 계산합니다",
    "",
    "![토큰 × 단가로 요청별 비용을 추정하는 방법](docs/diagrams/cost-estimation.svg)",
    "",
    "```text",
    "추정 USD = ((prompt − cached) × 입력단가 + cached × 캐시 입력단가 + completion × 출력단가) ÷ 1,000,000",
    "```",
    "",
    "* cached 토큰은 prompt 토큰에 **포함**되어 있으므로 빼고 계산합니다. reasoning 토큰은 completion에 이미 포함되어 따로 더하지 않습니다.",
    "* 캐시 토큰 수는 응답 usage에서 가져옵니다. Chat Completions는 `usage.prompt_tokens_details.cached_tokens`, Responses API는 `usage.input_tokens_details.cached_tokens`입니다.",
    "* 롱컨텍스트 구간은 **요청 1건의 입력 토큰 수**로 정해지며 출력 토큰과 무관합니다(Microsoft Learn). 그래서 합산된 메트릭으로는 어떤 요청이 해당하는지 알 수 없고, 요청별 usage 로깅이 필요합니다.",
    "* 2026-10-15에 조회한 Azure 게시 단가에서 GPT-5.6 long context 행은 short 대비 입력·캐시 2배, 출력 1.5배였고 Flex는 Standard의 50%, Priority는 2배, Data Zone은 Global보다 약 10% 높았습니다. 모델·리전별로 직접 확인하세요.",
    "* Azure 가격표에는 cache write meter가 별도로 있고 입력 단가의 1.25배로 게시되어 있습니다. 이 데모는 cache write 과금을 구현하지 않으므로 해당 토큰이 오면 미산정으로 처리합니다.",
    "* 이 데모의 단가 적용 범위는 Global Standard · short context · prompt 4,096 토큰 이하입니다. 범위 밖이거나 usage가 없으면 0이 아니라 미산정입니다.",
    "",
    "## 화면에서 확인하기",
    "",
    "세 화면은 같은 데이터를 서로 다른 목적으로 보여 줍니다. 비교와 선택 기준은 [화면 비교](docs/dashboard.md)에 있습니다.",
    "",
    "![Azure Portal Shared Dashboard: 서비스 전체 요청·토큰·지연 요약](img/shareddashboard.png)",
    "",
    "*Shared Dashboard — 운영팀이 먼저 보는 요약 상황판입니다. Azure Monitor 메트릭(요청 수, 입력·출력 토큰, 마지막 byte까지의 시간, 총 추론 토큰)을 고정해 둡니다.*",
    "",
    "![Azure Workbook: 요청 추이·결과별 호출·모델별 비교](img/workbook.png)",
    "",
    "*Workbook — 분석 화면입니다. 기간·모델 배포·live/fixture·Run UUID를 바꿔 가며 요청 추이, 결과별 호출(성공/429/오류), 모델별 비용과 차단 요청을 조회합니다.*",
    "",
    "![Azure Managed Grafana: 요청·토큰·캐시 추이와 모델별 비교](img/grafana.png)",
    "",
    "*Managed Grafana — 지속 시계열 관제 화면입니다. 같은 요청별 데이터와 서비스 메트릭을 한 화면에서 새로 고침하며 봅니다.*",
    "",
    "## 한계와 경계",
    "",
    "* 비용은 검증된 Azure 공개 단가 기반 **추정**이며 청구 invoice가 아닙니다. Cost Management의 일별 비용과 대사하세요.",
    "* 위의 일일 예산과 동시 실행 제한은 **이 로컬 Worker**의 안전장치입니다. 공개 웹 데모(Static Web App)에는 앱이 정한 비용·동시 실행 상한이 없습니다. Azure 자체 quota(429)와 실제 청구는 그대로 적용됩니다.",
    "* 예산 소진·인증 오류·단가 만료는 호출을 대기시키고 Worker는 유지합니다. 중지는 Stop-LoadTest.ps1로 합니다.",
    "* 메트릭만으로는 **차단된 내용 파악**과 **캐시·롱컨텍스트를 반영한 정확한 비용**을 알 수 없습니다. 앱이나 APIM에서 요청별 로그를 남겨야 합니다.",
    "* 검증 범위와 미검증 항목은 [검증 기록](docs/validation.md)을 확인하세요. 이 보고서의 자동 갱신은 로컬 파일에 적용되며 GitHub에는 마지막 commit 시점의 snapshot이 있습니다.",
    "",
    "## 데모 시나리오와 burst",
    "",
    `* Synthetic cycles: ${input.scenarioCycles}; fixture events: ${input.syntheticEvents}; interval seconds: ${input.scenarioInterval ?? "disabled"}.`,
    "* Fixture는 실제 API 요청도 청구 대상 토큰도 아니며 live ledger와 분리해 저장합니다.",
    `* Worker 일일 추정 경고: ${warning} USD (70%); 중지 임계치: ${input.dailyBudgetUsd} USD.`,
    `* 마지막 burst: ${input.lastBurst ? JSON.stringify(input.lastBurst) : "not started"}. 목표 RPS는 보장된 처리량이 아닙니다.`,
    "",
    "## 공개 웹 데모 검증 기록 (2026-10-14)",
    "",
    "* GitHub 로그인 요구를 제거하고 공개 고객 데모로 게시했습니다.",
    "* 시작 실패를 HTTP 403으로 재현했고, 경고 갱신에 필요한 LAW와 Action Group 읽기 역할을 해당 리소스 범위에만 추가했습니다.",
    "* API canary `a215f13e-f99e-4690-aedc-6b45e43a67a3`와 브라우저 canary `32870ed6-c444-415d-933d-30e220a081df`: 각각 세 deployment 1회씩 성공 3회, LAW에서 LIVE 성공과 별도 합성 이벤트 27개를 확인했습니다.",
    "* 당시에는 공유 예산 안전장치가 있었으며, 이후 앱 정의 비용·동시 실행 상한을 제거했습니다. 위 기록은 제거 이전 시점입니다.",
    "* 합성 실행 후 Azure Alerts Management에서 guardrail·throttle 경고의 Fired를 확인했습니다. 이메일 수신자 Enabled와 실제 inbox 도착은 별개이며 inbox는 접근 권한이 없어 검증하지 못했습니다.",
    "* Storage private endpoint는 조직 정책 때문에 유지합니다. 공개 UI/API 이용에 로그인은 필요하지 않습니다.",
    "",
  ].join("\n");
}
