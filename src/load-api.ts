import { AzureCliCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";
import { StreamingCollector, type StreamFailure } from "./streaming.js";
import type { PriceCard, RequestContext, RequestEvent } from "./accounting.js";
import type { LoadProfile } from "./load-policy.js";

export function loadClient(endpoint: string, timeout: number): AzureOpenAI {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".openai.azure.com")) throw new Error("Untrusted load endpoint.");
  return new AzureOpenAI({
    endpoint: url.href, apiVersion: "2024-10-21", maxRetries: 0, timeout,
    azureADTokenProvider: getBearerTokenProvider(new AzureCliCredential({ processTimeoutInMs: 30000 }),
      "https://cognitiveservices.azure.com/.default"),
  });
}
export async function invokeLoad(client: AzureOpenAI, context: RequestContext, price: PriceCard,
  profile: LoadProfile, prompt: string, signal: AbortSignal): Promise<RequestEvent> {
  const started = performance.now();
  const collector = new StreamingCollector(context, price);
  let failure: StreamFailure | undefined;
  try {
    const stream = await client.chat.completions.create({
      model: context.deployment, messages: [{ role: "user", content: prompt }],
      max_completion_tokens: profile.outputTokens, stream: true, stream_options: { include_usage: true },
    }, { signal });
    for await (const chunk of stream) collector.accept(chunk, Math.round(performance.now() - started));
  } catch (error: unknown) {
    failure = { kind: signal.aborted ? "cancelled" : "error", error };
  }
  return collector.finish(Math.max(1, Math.round(performance.now() - started)), failure);
}
