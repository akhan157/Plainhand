import { AsyncLocalStorage } from 'node:async_hooks';
import { MemoryStorage } from '../../plainhand/storage.mjs';
// Transactional in-memory test double; same reentrant contract as PostgresStorage.
export class TransferMemory extends MemoryStorage {
  scope = new AsyncLocalStorage();
  chain = Promise.resolve();
  exclusive(fn) {
    if (this.scope.getStore()) return fn();
    const result = this.chain.then(() => this.scope.run(true, async () => {
      const before = new Map(this.files);
      try { return await fn(); } catch (error) { this.files = before; throw error; }
    }));
    this.chain = result.catch(() => {});
    return result;
  }
}
