import { readFile } from "node:fs/promises";
import { record, validatePrice, type PriceCard } from "./accounting.js";

export interface ModelConfig {
  deployment: string;
  model: string;
  modelVersion: string;
  deploymentSku: string;
  capacity: number;
}

export async function loadModels(path: string): Promise<ModelConfig[]> {
  const data = record(JSON.parse(await readFile(path, "utf8")));
  if (!Array.isArray(data.models) || data.models.length < 1 || data.models.length > 10) {
    throw new Error("Model configuration must have 1..10 deployments.");
  }
  const models = data.models.map(value => {
    const m = record(value);
    function identifier(key: string): string {
      const id = m[key];
      if (typeof id !== "string" || !/^[a-zA-Z\d._-]{1,64}$/.test(id)) {
        throw new Error(`Invalid model configuration: ${key}.`);
      }
      return id;
    }
    if (!Number.isInteger(m.capacity) || typeof m.capacity !== "number" || m.capacity < 1) {
      throw new Error("Invalid model quota capacity.");
    }
    return {
      deployment: identifier("deployment"), model: identifier("model"),
      modelVersion: identifier("modelVersion"), deploymentSku: identifier("deploymentSku"), capacity: m.capacity,
    };
  });
  if (new Set(models.map(m => m.deployment)).size !== models.length) throw new Error("Duplicate model deployments.");
  return models;
}

export function selectModels(models: ModelConfig[], selection: string | undefined): ModelConfig[] {
  if (selection === undefined) return models;
  const names = selection.split(",").map(name => name.trim());
  if (new Set(names).size !== names.length) throw new Error("Duplicate deployment selection.");
  return names.map(name => {
    const model = models.find(m => m.deployment === name);
    if (!model) throw new Error(`Unknown deployment: ${name}.`);
    return model;
  });
}

export async function loadPriceCards(path: string, models: ModelConfig[]): Promise<Map<string, PriceCard>> {
  const cards: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(cards)) throw new Error("Expected an array of per-model price cards.");
  const prices = new Map<string, PriceCard>();
  for (const model of models) {
    const matched = cards.filter(value => {
      const p = record(value);
      return p.model === model.model && p.modelVersion === model.modelVersion && p.deploymentSku === model.deploymentSku;
    });
    if (matched.length !== 1) throw new Error(`Expected exactly one price card for ${model.deployment}.`);
    const card: unknown = matched[0];
    validatePrice(card, model);
    prices.set(model.deployment, card);
  }
  return prices;
}
