/**
 * Simple in-memory response cache
 * Reduces AI calls for repeated common questions
 * Easy to replace with Redis later
 */

class SimpleCache {
  constructor(ttlMs = 10 * 60 * 1000, maxSize = 200) {
    this.store = new Map();
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  _key(text) {
    return (text || '').toLowerCase().trim().slice(0, 120);
  }

  get(text) {
    const k = this._key(text);
    const item = this.store.get(k);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.store.delete(k);
      return null;
    }
    return item.value;
  }

  set(text, value) {
    if (this.store.size >= this.maxSize) {
      // remove oldest
      const first = this.store.keys().next().value;
      this.store.delete(first);
    }
    this.store.set(this._key(text), {
      value,
      expires: Date.now() + this.ttlMs
    });
  }

  clear() {
    this.store.clear();
  }
}

module.exports = new SimpleCache();
