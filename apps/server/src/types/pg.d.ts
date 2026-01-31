declare module "pg" {
  export type QueryResult = { rows: any[] };
  export type QueryConfig = any;

  export interface PoolClient {
    query: (queryTextOrConfig: string | QueryConfig, values?: any[]) => Promise<QueryResult>;
    release: () => void;
  }

  export class Pool {
    constructor(config?: any);
    connect: () => Promise<PoolClient>;
    query: (queryTextOrConfig: string | QueryConfig, values?: any[]) => Promise<QueryResult>;
  }
}
