import { describe, expect, it } from "vitest";
import { mapResultCodeToErrorType, type ErrorType } from "../../shared/contracts/index.js";

describe("mapResultCodeToErrorType", () => {
  it.each<{ resultCode: string; expected: ErrorType }>([
    { resultCode: "0", expected: "other" },
    { resultCode: "200", expected: "other" },
    { resultCode: "500", expected: "server_5xx" },
    { resultCode: "502", expected: "server_5xx" },
    { resultCode: "504", expected: "timeout" },
    { resultCode: "429", expected: "rate_limit" },
    { resultCode: "rate_limit_exceeded", expected: "rate_limit" },
    { resultCode: "401", expected: "auth" },
    { resultCode: "403", expected: "auth" },
    { resultCode: "authentication_failed", expected: "auth" },
    { resultCode: "408", expected: "timeout" },
    { resultCode: "timeout", expected: "timeout" },
    { resultCode: "400", expected: "client_4xx" },
    { resultCode: "404", expected: "client_4xx" },
    { resultCode: "content_filter", expected: "content_filter" },
    { resultCode: "cancelled", expected: "cancelled" },
    { resultCode: "unexpected", expected: "other" },
  ])("maps $resultCode to $expected", ({ resultCode, expected }) => {
    expect(mapResultCodeToErrorType(resultCode)).toBe(expected);
  });
});
