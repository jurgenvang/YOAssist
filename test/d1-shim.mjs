/**
 * Minimale nabootsing van de D1-interface bovenop better-sqlite3, zodat
 * sync.js ongewijzigd getest kan worden. Ondersteunt precies wat de code
 * gebruikt: prepare().bind().first()/all()/run() en db.batch().
 */
import Database from 'better-sqlite3';

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  #stmt() {
    return this.db.prepare(this.sql);
  }

  async first() {
    const rij = this.#stmt().get(...this.params);
    return rij ?? null;
  }

  async all() {
    return { results: this.#stmt().all(...this.params), success: true };
  }

  async run() {
    const info = this.#stmt().run(...this.params);
    return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
  }
}

export class D1Shim {
  constructor(pad = ':memory:') {
    this.db = new Database(pad);
    this.db.pragma('foreign_keys = ON');
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    const uitvoeren = this.db.transaction(() => {
      for (const s of statements) this.db.prepare(s.sql).run(...s.params);
    });
    uitvoeren();
    return statements.map(() => ({ success: true }));
  }

  exec(sql) {
    this.db.exec(sql);
  }
}
