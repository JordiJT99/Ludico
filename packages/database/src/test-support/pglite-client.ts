import { type PGlite, type Results, type Transaction } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import type { QueryResult, SqlClient, TransactionClient } from "../sql-client.js";

export class PGliteClient implements SqlClient {
  constructor(private readonly database: PGlite) {}

  async close(): Promise<void> {
    await this.database.close();
  }

  async query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return toQueryResult(await this.database.query<T>(text, [...values]));
  }

  async transaction<T>(run: (client: TransactionClient) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) =>
      run(new PGliteTransaction(transaction)),
    );
  }
}

class PGliteTransaction implements TransactionClient {
  constructor(private readonly transaction: Transaction) {}

  async query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return toQueryResult(await this.transaction.query<T>(text, [...values]));
  }
}

function toQueryResult<T extends QueryResultRow>(result: Results<T>): QueryResult<T> {
  return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
}
