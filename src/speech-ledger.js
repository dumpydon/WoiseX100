export class SpeechLedger {
  constructor(sql, clock = Date.now) {
    this.sql = sql; this.clock = clock;
    sql.exec('CREATE TABLE IF NOT EXISTS charges (id TEXT PRIMARY KEY, day TEXT NOT NULL, characters INTEGER NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS charges_day ON charges(day)');
  }
  day() { return new Date(this.clock()).toISOString().slice(0, 10); }
  resetSeconds() { return Math.max(1, Math.ceil((Date.parse(this.day() + 'T00:00:00Z') + 86400000 - this.clock()) / 1000)); }
  totals() {
    return this.sql.exec("SELECT COALESCE(SUM(CASE WHEN state='submitted' THEN characters ELSE 0 END),0) AS used, COALESCE(SUM(CASE WHEN state='pending' AND expires>? THEN characters ELSE 0 END),0) AS reserved FROM charges WHERE day=?", this.clock(), this.day()).one();
  }
  reserve(id, characters, limit) {
    const previous = this.sql.exec('SELECT state FROM charges WHERE id=?', id).toArray()[0];
    if (previous) return { ok: true };
    const { used, reserved } = this.totals();
    if (used + reserved + characters > limit) return { ok: false, remaining: Math.max(0, limit - used - reserved), retryAfter: this.resetSeconds() };
    this.sql.exec('INSERT INTO charges VALUES (?,?,?,?,?)', id, this.day(), characters, 'pending', this.clock() + 120000);
    this.sql.exec('DELETE FROM charges WHERE day<?', new Date(this.clock() - 2 * 86400000).toISOString().slice(0, 10));
    return { ok: true };
  }
  commit(id) { this.sql.exec("UPDATE charges SET state='submitted' WHERE id=?", id); }
  release(id) { this.sql.exec('DELETE FROM charges WHERE id=?', id); }
  summary(limit, price) {
    const { used, reserved } = this.totals();
    return { submittedCharacters: used, reservedCharacters: reserved, remainingCharacters: Math.max(0, limit - used - reserved), dailyLimit: limit, estimatedCostUsd: used * price / 1000000, resetsInSeconds: this.resetSeconds() };
  }
}
