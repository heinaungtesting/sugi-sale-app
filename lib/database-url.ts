type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const SUPABASE_HOST_SUFFIXES = ['.supabase.co', '.supabase.com'];

export const RUNTIME_DATABASE_POOL_MAX = 1;

type RuntimeDatabasePoolOptions = Readonly<{
  connectionString: string;
  max: number;
  options: string;
}>;

function requirePostgresUrl(variableName: 'DATABASE_URL' | 'DIRECT_URL', connectionString: string | undefined): string {
  if (!connectionString) {
    throw new Error(`${variableName} is required for database access`);
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(`${variableName} must use a PostgreSQL URL`);
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${variableName} must use a PostgreSQL URL`);
  }

  const isSupabase = SUPABASE_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
  if (isSupabase && variableName === 'DATABASE_URL' && parsed.port !== '6543') {
    throw new Error('DATABASE_URL must use Supabase transaction pooling on port 6543');
  }
  if (isSupabase && variableName === 'DIRECT_URL' && parsed.port === '6543') {
    throw new Error('DIRECT_URL must use a direct or session-pooled Supabase connection, not port 6543');
  }

  return connectionString;
}

export function requireDatabaseUrl(environment: DatabaseEnvironment = process.env): string {
  return requirePostgresUrl('DATABASE_URL', environment.DATABASE_URL);
}

export function requireDirectUrl(environment: DatabaseEnvironment = process.env): string {
  return requirePostgresUrl('DIRECT_URL', environment.DIRECT_URL);
}

export function runtimeDatabasePoolOptions(connectionString: string): RuntimeDatabasePoolOptions {
  return {
    connectionString,
    max: RUNTIME_DATABASE_POOL_MAX,
    options: '-c search_path=pg_catalog,sugi',
  };
}
