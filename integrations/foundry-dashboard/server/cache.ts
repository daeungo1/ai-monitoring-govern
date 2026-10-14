export class ResponseCache {
  private readonly values = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly flights = new Map<string, Promise<unknown>>();

  constructor(private readonly ttlMs = 20_000) {}

  async getOrRun<T>(key: string, run: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > now) return cached.value as T;

    const existing = this.flights.get(key);
    if (existing) return (await existing) as T;

    const flight = run()
      .then((value) => {
        this.values.set(key, { expiresAt: Date.now() + this.ttlMs, value });
        return value;
      })
      .finally(() => {
        this.flights.delete(key);
      });
    this.flights.set(key, flight);
    return (await flight) as T;
  }
}
