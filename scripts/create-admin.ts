import bcrypt from 'bcryptjs';
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ADMINISTRATOR_FAILURE = 'Unable to create administrator.';
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/u;
const WHITESPACE = /\s/u;

type AdministratorRecord = {
  id: bigint | number | string;
  username: string;
  role: string;
};

type AdministratorCreateData = {
  username: string;
  displayName: string;
  pinHash: string;
  role: 'admin';
  isActive: true;
};

export type CreateAdministratorPrisma = {
  sugiUser: {
    findUnique(args: { where: { username: string } }): Promise<AdministratorRecord | null>;
    create(args: { data: AdministratorCreateData }): Promise<AdministratorRecord>;
  };
  $disconnect(): Promise<void>;
};

export type CreateAdministratorEnvironmentLoader = (options: { quiet: true }) => unknown | Promise<unknown>;

export type CreateAdministratorInput = {
  username: string;
  displayName: string;
  pin: string;
};

export type CreateAdministratorCommandDependencies = {
  args: string[];
  getNewAdminPin: () => string | undefined;
  loadEnvironment?: () => unknown | Promise<unknown>;
  loadPrisma: () => Promise<CreateAdministratorPrisma>;
  readHiddenPin: () => Promise<string>;
  writeSuccess: (line: string) => void;
  writeFailure: (line: string) => void;
};

const fail = (): never => {
  throw new Error(ADMINISTRATOR_FAILURE);
};

const codePointLength = (value: string) => Array.from(value).length;

export const normalizeUsername = (value: string): string => {
  const username = value.normalize('NFKC').trim().toLowerCase();
  if (!username || CONTROL_CHARACTER.test(username) || WHITESPACE.test(username) || codePointLength(username) > 64) {
    fail();
  }
  return username;
};

export const normalizeDisplayName = (value: string): string => {
  const displayName = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!displayName || CONTROL_CHARACTER.test(displayName) || codePointLength(displayName) > 100) {
    fail();
  }
  return displayName;
};

export const validateAdministratorPin = (value: string): string => {
  if (!/^[0-9]{6,64}$/u.test(value)) fail();
  return value;
};

export const parseCreateAdministratorArguments = (args: string[]): Pick<CreateAdministratorInput, 'username' | 'displayName'> => {
  if (args.length !== 2) fail();
  const [username, displayName] = args;
  return {
    username: normalizeUsername(username),
    displayName: normalizeDisplayName(displayName),
  };
};

export const createAdministrator = async (
  prisma: CreateAdministratorPrisma,
  input: CreateAdministratorInput,
): Promise<AdministratorRecord> => {
  const username = normalizeUsername(input.username);
  const displayName = normalizeDisplayName(input.displayName);
  const pin = validateAdministratorPin(input.pin);
  const existing = await prisma.sugiUser.findUnique({ where: { username } });
  if (existing) fail();

  const pinHash = await bcrypt.hash(pin, 10);
  const created = await prisma.sugiUser.create({
    data: { username, displayName, pinHash, role: 'admin', isActive: true },
  });
  return { id: created.id, username: created.username, role: created.role };
};

export const formatCreateAdministratorSuccess = (administrator: AdministratorRecord) =>
  `created administrator id=${administrator.id} username=${administrator.username} role=${administrator.role}`;

export const loadCreateAdministratorPrisma = async <T>(
  environmentLoader: CreateAdministratorEnvironmentLoader,
  prismaLoader: () => Promise<T>,
): Promise<T> => {
  await environmentLoader({ quiet: true });
  return prismaLoader();
};

type TtyInput = NodeJS.ReadStream & { setRawMode(mode: boolean): NodeJS.ReadStream };
type TtyOutput = NodeJS.WriteStream;

export const readHiddenAdministratorPin = (
  input: TtyInput = process.stdin,
  output: TtyOutput = process.stdout,
): Promise<string> => {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error(ADMINISTRATOR_FAILURE));
  }

  return new Promise((resolvePin, rejectPin) => {
    let pin = '';
    const cleanup = () => {
      input.off('data', onData);
      input.off('error', onError);
      input.setRawMode(false);
      input.pause();
    };
    const succeed = () => {
      cleanup();
      output.write('\n');
      resolvePin(pin);
    };
    const reject = () => {
      cleanup();
      output.write('\n');
      rejectPin(new Error(ADMINISTRATOR_FAILURE));
    };
    const onError = () => reject();
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          succeed();
          return;
        }
        if (character === '\u0003' || character === '\u0004') {
          reject();
          return;
        }
        if (character === '\u0008' || character === '\u007F') {
          pin = pin.slice(0, -1);
          continue;
        }
        if (!CONTROL_CHARACTER.test(character)) pin += character;
      }
    };

    output.write('New administrator PIN: ');
    input.setRawMode(true);
    input.on('data', onData);
    input.once('error', onError);
    input.resume();
  });
};

export const runCreateAdministratorCommand = async (
  dependencies: CreateAdministratorCommandDependencies,
): Promise<boolean> => {
  let prisma: CreateAdministratorPrisma | undefined;
  let created: AdministratorRecord | undefined;
  let failed = false;
  try {
    await dependencies.loadEnvironment?.();
    const input = parseCreateAdministratorArguments(dependencies.args);
    const pin = validateAdministratorPin(
      dependencies.getNewAdminPin() ?? await dependencies.readHiddenPin(),
    );
    prisma = await dependencies.loadPrisma();
    created = await createAdministrator(prisma, { ...input, pin });
  } catch {
    dependencies.writeFailure(ADMINISTRATOR_FAILURE);
    failed = true;
  } finally {
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch {
        if (!failed) {
          dependencies.writeFailure(ADMINISTRATOR_FAILURE);
          failed = true;
        }
      }
    }
  }
  if (failed || !created) return false;
  dependencies.writeSuccess(formatCreateAdministratorSuccess(created));
  return true;
};

export const finishCreateAdministratorCommand = (
  command: Promise<boolean>,
  writeFailure: (line: string) => void,
  setExitCode: (code: number) => void,
): Promise<void> => command.then((succeeded) => {
  if (!succeeded) setExitCode(1);
}).catch(() => {
  writeFailure(ADMINISTRATOR_FAILURE);
  setExitCode(1);
});

const main = async () => runCreateAdministratorCommand({
  args: process.argv.slice(2),
  getNewAdminPin: () => process.env.SUGI_NEW_ADMIN_PIN,
  loadEnvironment: () => loadDotenv({ quiet: true }),
  loadPrisma: async () => (await import('../lib/prisma')).prisma,
  readHiddenPin: () => readHiddenAdministratorPin(),
  writeSuccess: (line) => console.log(line),
  writeFailure: (line) => console.error(line),
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void finishCreateAdministratorCommand(
    main(),
    (line) => console.error(line),
    (code) => { process.exitCode = code; },
  );
}
