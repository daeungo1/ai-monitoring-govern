export const fixtures = [
  {
    name: "normal",
    response: {
      usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 400 } },
      prompt_filter_results: [{ content_filter_results: { hate: { filtered: false, severity: "safe" } } }],
      choices: [{ finish_reason: "stop", content_filter_results: { violence: { filtered: false, severity: "safe" } } }],
    },
  },
  {
    name: "input-blocked",
    error: { status: 400, error: { code: "content_filter", innererror: {
      code: "ResponsibleAIPolicyViolation", content_filter_result: {
        violence: { filtered: true, severity: "high" },
      },
    } } },
  },
  {
    name: "output-blocked",
    response: {
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [{ finish_reason: "content_filter", content_filter_results: {
        sexual: { filtered: true, severity: "medium" },
      } }],
    },
  },
  { name: "throttled", error: { status: 429, error: { code: "rate_limit_exceeded" } } },
  { name: "server-error", error: { status: 503 } },
  {
    name: "filter-unavailable",
    response: { usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [{ finish_reason: "stop", content_filter_results: { error: { code: "content_filter_error" } } }] },
  },
  { name: "usage-missing", response: { choices: [{ finish_reason: "stop" }] } },
  { name: "stream-cancelled", chunks: [{ choices: [{ delta: { content: "safe fixture" } }] }], cancelled: true },
  { name: "stream-incomplete", chunks: [{ choices: [{ delta: { content: "safe fixture" } }] }], cancelled: false },
] as const;
