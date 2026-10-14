import { z } from "zod";
import rootSnapshot from "../config/model-prices.json" with { type: "json" };

const VerifiedCardSchema = z.object({
  model: z.string().min(1),
  modelVersion: z.string().min(1),
  deploymentSku: z.literal("GlobalStandard"),
  currency: z.literal("USD"),
  contextTier: z.literal("short"),
  maxPromptTokens: z.literal(4096),
  inputPerMillion: z.number().nonnegative(),
  cachedInputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verifiedAt: z.string().datetime(),
  status: z.literal("verified"),
  source: z.literal("https://azure.microsoft.com/en-us/pricing/details/azure-openai/"),
});

export const VerifiedPriceCardsSchema = z.array(VerifiedCardSchema).nonempty().superRefine((cards, ctx) => {
  const keys = cards.map(card => `${card.model}/${card.modelVersion}/${card.deploymentSku}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate verified price cards." });
  if (new Set(cards.map(card => card.verifiedAt.slice(0, 10))).size !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Price cards must belong to one explicitly dated verified snapshot." });
  }
  if (cards.some(card => card.effectiveFrom >= card.effectiveTo)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Price card effective window is invalid." });
  }
});

const verifiedCards = VerifiedPriceCardsSchema.parse(rootSnapshot);
export const RETAIL_PRICES = verifiedCards.map(card => ({
  model: card.model, version: card.modelVersion, deploymentSku: card.deploymentSku,
  maxPromptTokens: card.maxPromptTokens, inputPer1M: card.inputPerMillion,
  cachedPer1M: card.cachedInputPerMillion, outputPer1M: card.outputPerMillion,
}));
export const RETAIL_BASIS = `Current retail snapshot ${verifiedCards[0].verifiedAt.slice(0, 10)} · USD/1M · GlobalStandard ≤4096 prompt tokens · root verified rate cards · not invoice`;
