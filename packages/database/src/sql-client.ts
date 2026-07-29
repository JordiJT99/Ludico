import { Pool, type QueryResultRow } from "pg";

export interface QueryResult<T extends QueryResultRow> {
  readonly rows: T[];
  readonly rowCount: number;
}

export interface TransactionClient {
  query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export interface SqlClient extends TransactionClient {
  close(): Promise<void>;
  transaction<T>(run: (client: TransactionClient) => Promise<T>): Promise<T>;
}

export class PostgresClient implements SqlClient {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({ connectionString, max: 10 });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.#pool.query<T>(text, [...values]);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(run: (client: TransactionClient) => Promise<T>): Promise<T> {
    const connection = await this.#pool.connect();
    const client: TransactionClient = {
      query: async <R extends QueryResultRow>(text: string, values: readonly unknown[] = []) => {
        const result = await connection.query<R>(text, [...values]);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
    };

    try {
      await connection.query("begin");
      const result = await run(client);
      await connection.query("commit");
      return result;
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }
}
