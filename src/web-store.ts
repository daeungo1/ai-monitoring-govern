import { ContainerClient, RestError, type BlockBlobClient } from "@azure/storage-blob";
import type { TokenCredential } from "@azure/identity";
import type { RequestEvent } from "./accounting.js";
import { WebError, type WebClaim } from "./web-policy.js";
import type { WebLedger, WebStore } from "./web-service.js";

export class BlobWebStore implements WebStore {
  private readonly container: ContainerClient;
  private readonly ledger: BlockBlobClient;
  private initialized: Promise<void> | undefined;
  constructor(url: string, credential: TokenCredential, private readonly seedUsd: number,
    private readonly seedDay: string) {
    this.container = new ContainerClient(url, credential, { retryOptions: { maxTries: 3 } });
    this.ledger = this.container.getBlockBlobClient("ledger.json");
  }
  private async ready(): Promise<void> {
    if (!this.initialized) this.initialized = this.initialize();
    try { await this.initialized; }
    catch (error) { this.initialized = undefined; throw error; }
  }
  private async initialize(): Promise<void> {
    await this.container.createIfNotExists();
    const day = new Date().toISOString().slice(0, 10);
    const state: WebLedger = { day, accountedUsd: day === this.seedDay ? this.seedUsd : 0,
      limitUsd: null, activeRun: null, runs: {} };
    try {
      const data = JSON.stringify(state);
      await this.ledger.upload(data, Buffer.byteLength(data), { conditions: { ifNoneMatch: "*" } });
    } catch (error) {
      if (!(error instanceof RestError) || ![409, 412].includes(error.statusCode ?? 0)) throw error;
    }
  }
  async readLedger(): Promise<WebLedger> {
    await this.ready();
    const value: WebLedger = JSON.parse((await this.ledger.downloadToBuffer()).toString("utf8"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !Number.isFinite(value.accountedUsd)
      || value.accountedUsd < 0) throw new Error("Invalid persisted budget.");
    return value;
  }
  async transaction<T>(change: (ledger: WebLedger) => Promise<T>): Promise<T> {
    await this.ready();
    const lease = this.ledger.getBlobLeaseClient();
    let acquired = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await lease.acquireLease(60); acquired = true; break; }
      catch (error) {
        if (!(error instanceof RestError) || error.statusCode !== 409) throw error;
        await new Promise(resolve => setTimeout(resolve, 100 + attempt * 10));
      }
    }
    if (!acquired) throw new WebError(503, "Budget controller is busy. Retry after a few seconds.");
    try {
      const state = await this.readLedger();
      const result = await change(state);
      const data = JSON.stringify(state);
      await this.ledger.upload(data, Buffer.byteLength(data), { conditions: { leaseId: lease.leaseId } });
      return result;
    } finally { await lease.releaseLease(); }
  }
  private callBlob(runId: string, index: number) {
    return this.container.getBlockBlobClient(`calls/${runId}/${String(index).padStart(4, "0")}.json`);
  }
  async listClaims(runId: string): Promise<WebClaim[]> {
    await this.ready();
    const names: string[] = [];
    for await (const blob of this.container.listBlobsFlat({ prefix: `calls/${runId}/` })) names.push(blob.name);
    const claims: WebClaim[] = [];
    for (let i = 0; i < names.length; i += 32) {
      claims.push(...await Promise.all(names.slice(i, i + 32).map(async name => {
        const claim: WebClaim = JSON.parse((await this.container.getBlockBlobClient(name).downloadToBuffer()).toString("utf8"));
        return claim;
      })));
    }
    return claims.sort((a, b) => a.index - b.index);
  }
  async claim(runId: string, index: number, startedAt: number): Promise<boolean> {
    const data = JSON.stringify({ index, startedAt });
    try {
      await this.callBlob(runId, index).upload(data, Buffer.byteLength(data), {
        conditions: { ifNoneMatch: "*" }, metadata: { state: "pending", started: String(startedAt) },
      });
      return true;
    } catch (error) {
      if (error instanceof RestError && [409, 412].includes(error.statusCode ?? 0)) return false;
      throw error;
    }
  }
  private async finish(runId: string, index: number, update: Partial<WebClaim>) {
    const blob = this.callBlob(runId, index);
    const previous: WebClaim = JSON.parse((await blob.downloadToBuffer()).toString("utf8"));
    const data = JSON.stringify({ ...previous, ...update });
    await blob.upload(data, Buffer.byteLength(data), { metadata: { state: "finished", started: String(previous.startedAt) } });
  }
  async complete(runId: string, index: number, event: RequestEvent): Promise<void> {
    await this.finish(runId, index, { event });
  }
  async cancel(runId: string, index: number): Promise<void> { await this.finish(runId, index, { cancelled: true }); }

  async countActive(runId: string, now: number): Promise<number> {
    let count = 0;
    for await (const blob of this.container.listBlobsFlat({ prefix: `calls/${runId}/`, includeMetadata: true })) {
      if (blob.metadata?.state === "pending" && now - Number(blob.metadata.started) < 60000) count++;
    }
    return count;
  }

}
