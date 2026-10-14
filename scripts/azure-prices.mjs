import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const pricingPage = "https://azure.microsoft.com/en-us/pricing/details/azure-openai/";
const meterPrefixes = { "gpt-6-luna": "6-luna", "gpt-5.6-luna": "5.6 luna", "gpt-5.6-terra": "5.6 terra" };

export function extractRateCard(items, model, day) {
  const prefix = meterPrefixes[model.model];
  if (!prefix || model.deploymentSku !== "GlobalStandard") throw new Error("Unsupported Azure meter mapping.");
  const meters = {};
  for (const [field, kind] of Object.entries({
    inputPerMillion: "Inp", cachedInputPerMillion: "Cd Inp",
    outputPerMillion: "Opt", cacheWritePerMillion: "Cd Wr",
  })) {
    const found = items.filter(i => i.skuName === `${prefix} ShortCo ${kind} Std Gl`
      && i.armRegionName === "eastus2" && i.currencyCode === "USD" && i.type === "Consumption"
      && i.unitOfMeasure === "1M" && i.tierMinimumUnits === 0
      && i.effectiveStartDate.slice(0, 10) <= day);
    if (found.length !== 1 || !Number.isFinite(found[0].retailPrice) || found[0].retailPrice < 0) {
      throw new Error(`Expected exactly one valid Azure meter: ${prefix} / ${kind}.`);
    }
    meters[field] = found[0];
  }
  return {
    model: model.model, modelVersion: model.modelVersion, deploymentSku: model.deploymentSku,
    currency: "USD", region: "eastus2", contextTier: "short", maxPromptTokens: 4096,
    ...Object.fromEntries(Object.entries(meters).map(([field, meter]) => [field, meter.retailPrice])),
    effectiveFrom: day, effectiveTo: new Date(Date.parse(day) + 31 * 86400000).toISOString().slice(0, 10),
    source: pricingPage, status: "verified", verifiedAt: new Date().toISOString(),
    priceBasis: "Azure public retail; not negotiated invoice",
    meters: Object.fromEntries(Object.entries(meters).map(([field, meter]) => [field, {
      meterId: meter.meterId, skuName: meter.skuName, meterName: meter.meterName,
      unitOfMeasure: meter.unitOfMeasure, effectiveStartDate: meter.effectiveStartDate, retailPrice: meter.retailPrice,
    }])),
  };
}

export async function refreshPrices() {
  const models = JSON.parse(await readFile("config/models.json", "utf8")).models;
  const day = new Date().toISOString().slice(0, 10);
  const filter = "armRegionName eq 'eastus2' and type eq 'Consumption' and (contains(meterName,'luna') or contains(meterName,'terra'))";
  const api = `https://prices.azure.com/api/retail/prices?currencyCode=USD&$filter=${encodeURIComponent(filter)}`;
  let next = api;
  const items = [];
  while (next) {
    if (new URL(next).hostname !== "prices.azure.com") throw new Error("Unexpected pricing API pagination host.");
    const response = await fetch(next, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Azure Retail Prices HTTP ${response.status}.`);
    const result = await response.json();
    items.push(...result.Items); next = result.NextPageLink;
  }
  const pageResponse = await fetch(pricingPage, { signal: AbortSignal.timeout(60000) });
  if (!pageResponse.ok) throw new Error(`Azure pricing page HTTP ${pageResponse.status}.`);
  const html = await pageResponse.text();
  const cards = models.map(model => extractRateCard(items, model, day));
  const crossChecks = [];
  for (const card of cards) {
    const label = card.model === "gpt-6-luna" ? "GPT-6 Luna" : card.model.replace("gpt", "GPT");
    const matching = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
      .map(m => m[1]).filter(row => row.includes(`${label} (short context) Global`) && row.includes("data-amount"));
    const rates = matching.map(row => [...row.matchAll(/data-amount='([^']+)'/g)]
      .map(m => JSON.parse(m[1].replace(/&quot;/g, '"')).regional?.["us-east-2"])).find(values => values.length >= 4);
    const expected = [card.inputPerMillion, card.cachedInputPerMillion, card.cacheWritePerMillion, card.outputPerMillion];
    if (!rates || expected.some((rate, i) => rate !== rates[i])) throw new Error(`Pricing page/API mismatch: ${card.model}.`);
    crossChecks.push({ model: card.model, pageLabel: `${label} (short context) Global`, rates: rates.slice(0, 4) });
  }
  await writeFile("config/model-prices.json", JSON.stringify(cards, null, 2) + "\n");
  await writeFile("config/azure-price-evidence.json", JSON.stringify({
    verifiedAt: new Date().toISOString(), api, pricingPage, crossChecks,
    mapping: "ShortCo / Inp / Cd Inp / Cd Wr / Opt / Std Gl / USD / eastus2 / unit 1M",
    scope: "Demo text prompts <=4096 tokens, default processing; long context/priority/flex/PTU not substituted.",
  }, null, 2) + "\n");
  console.log(JSON.stringify(cards.map(c => ({ model: c.model, input: c.inputPerMillion,
    cached: c.cachedInputPerMillion, output: c.outputPerMillion, cacheWrite: c.cacheWritePerMillion }))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  refreshPrices().catch(error => { console.error(error.message); process.exitCode = 1; });
}
