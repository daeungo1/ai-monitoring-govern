import type { PriceTableRow } from "../shared/contracts/index.js";

export const PRICE_SOURCE = "estimated · configurable · default-2026-03";

export const PRICE_TABLE: PriceTableRow[] = [
  // Estimated from Azure AI Foundry portal Monitor totals for this account.
  // Keep configurable: these rows approximate portal "Estimated cost" for token-based gpt-5.4 usage.
  { model: "gpt-5.4-2026-03-17", inputPer1M: 1.7, outputPer1M: 8.75, cachedPer1M: 0.85 },
  { model: "gpt-5.4", inputPer1M: 1.7, outputPer1M: 8.75, cachedPer1M: 0.85 },
  { model: "gpt-5.4-mini-2026-03-17", inputPer1M: 0.6, outputPer1M: 2.4, cachedPer1M: 0.06 },
  { model: "gpt-5.4-nano-2026-03-17", inputPer1M: 0.15, outputPer1M: 0.6, cachedPer1M: 0.015 },
  { model: "gpt-5.4-mini", inputPer1M: 0.6, outputPer1M: 2.4, cachedPer1M: 0.06 },
  { model: "gpt-5.4-nano", inputPer1M: 0.15, outputPer1M: 0.6, cachedPer1M: 0.015 },
];

export const UNKNOWN_MODEL_PRICE_NOTE = "Unknown token model or non-token-priced model (for example image generation); estimated token cost defaults to 0.";

export function findPrice(model: string): PriceTableRow | undefined {
  const normalized = model.toLowerCase();
  return [...PRICE_TABLE]
    .sort((a, b) => b.model.length - a.model.length)
    .find((row) => {
      const rowModel = row.model.toLowerCase();
      return normalized === rowModel || normalized.startsWith(`${rowModel}-`);
    });
}

export function estimateCost(model: string, input: number, output: number, cached: number): number {
  const price = findPrice(model);
  if (!price) return 0;
  const billableInput = Math.max(0, input - cached);
  return (
    (billableInput / 1_000_000) * price.inputPer1M +
    (cached / 1_000_000) * (price.cachedPer1M ?? price.inputPer1M) +
    (output / 1_000_000) * price.outputPer1M
  );
}

export function costPer1kInput(model: string): number {
  return (findPrice(model)?.inputPer1M ?? 0) / 1000;
}

export function costPer1kOutput(model: string): number {
  return (findPrice(model)?.outputPer1M ?? 0) / 1000;
}
