// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { RETAIL_PRICES } from "../../server/adapters/workspace.js";
import { VerifiedPriceCardsSchema } from "../../server/retail-snapshot.js";

it("vendors the exact root verified cards rather than app-local rate defaults", async () => {
  const bundled = JSON.parse(await readFile(new URL("../../config/model-prices.json", import.meta.url), "utf8"));
  const root = JSON.parse(await readFile(new URL("../../../../config/model-prices.json", import.meta.url), "utf8"));
  expect(bundled).toEqual(root);
  expect(RETAIL_PRICES.map(card => [card.model, card.version, card.inputPer1M, card.cachedPer1M, card.outputPer1M]))
    .toEqual(root.map((card: { model: string; modelVersion: string; inputPerMillion: number; cachedInputPerMillion: number; outputPerMillion: number }) =>
      [card.model, card.modelVersion, card.inputPerMillion, card.cachedInputPerMillion, card.outputPerMillion]));
});

it("rejects unverified rates and never substitutes upstream app defaults", async () => {
  const cards = JSON.parse(await readFile(new URL("../../config/model-prices.json", import.meta.url), "utf8"));
  expect(() => VerifiedPriceCardsSchema.parse([])).toThrow();
  expect(() => VerifiedPriceCardsSchema.parse([{ ...cards[0], status: "illustrative" }])).toThrow();
  expect(() => VerifiedPriceCardsSchema.parse([{ ...cards[0], cachedInputPerMillion: null }])).toThrow();
  expect(() => VerifiedPriceCardsSchema.parse([cards[0], cards[0]])).toThrow();
});
