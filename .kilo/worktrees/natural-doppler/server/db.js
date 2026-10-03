import sql from 'mssql';

let poolPromise;

function configFromEnv() {
  return {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 1433),
    options: {
      encrypt: false,
      trustServerCertificate: true
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 10000,
    requestTimeout: 30000
  };
}

export function getDbConfigStatus() {
  return {
    server: process.env.DB_SERVER || null,
    port: Number(process.env.DB_PORT || 1433),
    databaseConfigured: Boolean(process.env.DB_DATABASE),
    userConfigured: Boolean(process.env.DB_USER),
    passwordConfigured: Boolean(process.env.DB_PASSWORD),
    encrypt: false,
    trustServerCertificate: true
  };
}

export function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(configFromEnv()).catch(error => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

export { sql };