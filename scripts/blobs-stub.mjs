/**
 * A blob store the test can break on purpose, and one that races the way the
 * real one does: a write claiming an out-of-date version tag is *not* reliably
 * refused. That is the behaviour the app has to survive.
 */
const keys = new Map();

export const control = {
  failReads: false,
  failWrites: false,
  reads: 0,
  writes: 0,
  /** How many clients were built. The real one carries a token that expires. */
  built: 0,
  /** Runs once after the next read, standing in for another instance writing. */
  afterNextRead: null,
  seed(key, value) {
    keys.set(key, JSON.stringify(value));
  },
  raw(key) {
    const v = keys.get(key);
    return v ? JSON.parse(v) : null;
  },
  has(prefix) {
    return [...keys.keys()].filter((k) => k.startsWith(prefix)).sort();
  },
  reset() {
    keys.clear();
    this.failReads = false;
    this.failWrites = false;
    this.reads = 0;
    this.writes = 0;
    this.afterNextRead = null;
  },
};

export function getStore() {
  control.built += 1;
  return {
    async get(key) {
      control.reads += 1;
      if (control.failReads) throw new Error("simulated blob outage");
      const body = keys.get(key) ?? null;
      const hook = control.afterNextRead;
      if (hook) {
        control.afterNextRead = null;
        await hook();
      }
      return body;
    },
    async setJSON(key, value) {
      if (control.failWrites) throw new Error("simulated blob outage");
      control.writes += 1;
      keys.set(key, JSON.stringify(value));
    },
    async delete(key) {
      keys.delete(key);
    },
    async list({ prefix }) {
      control.reads += 1;
      if (control.failReads) throw new Error("simulated blob outage");
      return {
        blobs: [...keys.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((key) => ({ key })),
      };
    },
  };
}
