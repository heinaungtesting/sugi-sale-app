import bcrypt from 'bcryptjs';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createAdministrator,
  finishCreateAdministratorCommand,
  formatCreateAdministratorSuccess,
  loadCreateAdministratorPrisma,
  normalizeDisplayName,
  normalizeUsername,
  parseCreateAdministratorArguments,
  readHiddenAdministratorPin,
  runCreateAdministratorCommand,
  validateAdministratorPin,
  type CreateAdministratorPrisma,
} from '../scripts/create-admin';

type StoredUser = {
  id: bigint;
  username: string;
  displayName: string;
  pinHash: string;
  role: string;
  isActive: boolean;
};

class FakePrisma implements CreateAdministratorPrisma {
  readonly users = new Map<string, StoredUser>();
  disconnects = 0;

  sugiUser = {
    findUnique: async ({ where }: { where: { username: string } }) => this.users.get(where.username) ?? null,
    create: async ({ data }: { data: Omit<StoredUser, 'id'> }) => {
      const created = { id: 41n, ...data };
      this.users.set(created.username, created);
      return created;
    },
  };

  async $disconnect() {
    this.disconnects += 1;
  }
}

const validInput = {
  username: ' manager ',
  displayName: ' Store   Manager ',
  pin: '314159',
};

describe('administrator input normalization', () => {
  it('normalizes a username with NFKC, trimming, and lowercase', () => {
    expect(normalizeUsername('  ＡＤＭＩＮ  ')).toBe('admin');
  });

  it('rejects empty, whitespace-containing, control, and overlong usernames', () => {
    for (const username of ['', '  ', 'sales lead', 'sales\u0000lead', 'a'.repeat(65)]) {
      expect(() => normalizeUsername(username)).toThrow('Unable to create administrator.');
    }
  });

  it('normalizes a display name with collapsed whitespace', () => {
    expect(normalizeDisplayName('  Store\t\n Manager  ')).toBe('Store Manager');
  });

  it('rejects empty, control, and overlong display names', () => {
    for (const displayName of ['', '  ', 'Store\u0000Manager', 'a'.repeat(101)]) {
      expect(() => normalizeDisplayName(displayName)).toThrow('Unable to create administrator.');
    }
  });

  it('accepts only an ASCII six-to-sixty-four digit PIN', () => {
    expect(validateAdministratorPin('123456')).toBe('123456');
    expect(validateAdministratorPin('9'.repeat(64))).toBe('9'.repeat(64));
    for (const pin of ['12345', '1'.repeat(65), '１２３４５６', '123 456', '123456a', '']) {
      expect(() => validateAdministratorPin(pin)).toThrow('Unable to create administrator.');
    }
  });

  it('rejects a positional PIN instead of accepting it as command input', () => {
    expect(() => parseCreateAdministratorArguments(['manager', 'Store Manager', '314159']))
      .toThrow('Unable to create administrator.');
  });
});

describe('administrator creation', () => {
  it('hashes the PIN at cost 10 and creates exactly a normalized active admin', async () => {
    const prisma = new FakePrisma();

    const created = await createAdministrator(prisma, validInput);

    expect(created).toEqual({ id: 41n, username: 'manager', role: 'admin' });
    expect(prisma.users.get('manager')).toMatchObject({
      username: 'manager',
      displayName: 'Store Manager',
      role: 'admin',
      isActive: true,
    });
    const hash = prisma.users.get('manager')?.pinHash;
    expect(hash).toBeDefined();
    expect(await bcrypt.compare('314159', hash!)).toBe(true);
    expect(bcrypt.getRounds(hash!)).toBe(10);
  });

  it('refuses an existing username without changing it', async () => {
    const prisma = new FakePrisma();
    const existing: StoredUser = {
      id: 7n,
      username: 'manager',
      displayName: 'Existing User',
      pinHash: await bcrypt.hash('999999', 10),
      role: 'user',
      isActive: false,
    };
    prisma.users.set(existing.username, existing);

    await expect(createAdministrator(prisma, validInput)).rejects.toThrow('Unable to create administrator.');
    expect(prisma.users.get('manager')).toEqual(existing);
  });

  it('rejects an invalid PIN before database access', async () => {
    const prisma = new FakePrisma();
    let queries = 0;
    prisma.sugiUser.findUnique = async () => {
      queries += 1;
      return null;
    };

    await expect(createAdministrator(prisma, { ...validInput, pin: 'not-a-pin' }))
      .rejects.toThrow('Unable to create administrator.');
    expect(queries).toBe(0);
  });
});

describe('administrator command boundary', () => {
  it('loads dotenv quietly before dynamically importing Prisma', async () => {
    const order: string[] = [];
    const loaded = await loadCreateAdministratorPrisma(
      (options) => {
        expect(options).toEqual({ quiet: true });
        order.push('dotenv');
      },
      async () => {
        order.push('prisma');
        return { prisma: 'loaded-after-dotenv' };
      },
    );

    expect(loaded).toEqual({ prisma: 'loaded-after-dotenv' });
    expect(order).toEqual(['dotenv', 'prisma']);
  });

  it('formats successful output without display name, PIN, hash, URL, or credentials', () => {
    const output = formatCreateAdministratorSuccess({ id: 41n, username: 'manager', role: 'admin' });

    expect(output).toBe('created administrator id=41 username=manager role=admin');
    expect(output).not.toMatch(/Store Manager|314159|\$2[aby]\$|https?:|postgres/i);
  });

  it('reads an interactive PIN only from a TTY without writing the typed PIN', async () => {
    const input = Object.assign(new EventEmitter(), {
      isTTY: true,
      resume: () => undefined,
      pause: () => undefined,
      setRawMode: (_enabled: boolean) => input,
    });
    const output: string[] = [];
    const terminal = { isTTY: true, write: (chunk: string) => output.push(chunk) };

    const pin = readHiddenAdministratorPin(input as never, terminal as never);
    input.emit('data', Buffer.from('314159\r'));

    await expect(pin).resolves.toBe('314159');
    expect(output.join('')).toBe('New administrator PIN: \n');
  });

  it('refuses visible standard input for an interactive PIN', async () => {
    const input = Object.assign(new EventEmitter(), { isTTY: false });
    const terminal = { isTTY: true, write: () => undefined };

    await expect(readHiddenAdministratorPin(input as never, terminal as never))
      .rejects.toThrow('Unable to create administrator.');
  });

  it('uses the environment PIN non-interactively, emits safe output, and always disconnects', async () => {
    const prisma = new FakePrisma();
    const output: string[] = [];
    let interactiveReads = 0;

    await runCreateAdministratorCommand({
      args: ['manager', 'Store Manager'],
      getNewAdminPin: () => '314159',
      loadPrisma: async () => prisma,
      readHiddenPin: async () => {
        interactiveReads += 1;
        return 'should-not-be-read';
      },
      writeSuccess: (line) => output.push(line),
      writeFailure: (line) => output.push(line),
    });

    expect(interactiveReads).toBe(0);
    expect(output).toEqual(['created administrator id=41 username=manager role=admin']);
    expect(prisma.disconnects).toBe(1);
  });

  it('loads the environment before reading the non-interactive PIN or importing Prisma', async () => {
    const prisma = new FakePrisma();
    const env: { SUGI_NEW_ADMIN_PIN?: string } = {};
    const order: string[] = [];
    const output: string[] = [];

    await runCreateAdministratorCommand({
      args: ['manager', 'Store Manager'],
      getNewAdminPin: () => env.SUGI_NEW_ADMIN_PIN,
      loadEnvironment: async () => {
        order.push('dotenv');
        env.SUGI_NEW_ADMIN_PIN = '314159';
      },
      loadPrisma: async () => {
        order.push('prisma');
        return prisma;
      },
      readHiddenPin: async () => {
        throw new Error('visible stdin must not be used');
      },
      writeSuccess: (line) => output.push(line),
      writeFailure: (line) => output.push(line),
    });

    expect(order).toEqual(['dotenv', 'prisma']);
    expect(output).toEqual(['created administrator id=41 username=manager role=admin']);
  });

  it('writes a generic failure without PIN data and disconnects after a failed creation', async () => {
    const prisma = new FakePrisma();
    prisma.sugiUser.create = async () => {
      throw new Error('database unavailable for PIN 314159');
    };
    prisma.$disconnect = async () => {
      prisma.disconnects += 1;
      throw new Error('disconnect failed for postgresql://secret');
    };
    const output: string[] = [];

    const result = await runCreateAdministratorCommand({
      args: ['manager', 'Store Manager'],
      getNewAdminPin: () => '314159',
      loadPrisma: async () => prisma,
      readHiddenPin: async () => 'unused',
      writeSuccess: (line) => output.push(line),
      writeFailure: (line) => output.push(line),
    });

    expect(result).toBe(false);
    expect(output).toEqual(['Unable to create administrator.']);
    expect(output.join('\n')).not.toContain('314159');
    expect(prisma.disconnects).toBe(1);
  });

  it('turns a failed disconnect after creation into one generic failure', async () => {
    const prisma = new FakePrisma();
    prisma.$disconnect = async () => {
      prisma.disconnects += 1;
      throw new Error('disconnect failed for postgresql://secret');
    };
    const output: string[] = [];

    const result = await runCreateAdministratorCommand({
      args: ['manager', 'Store Manager'],
      getNewAdminPin: () => '314159',
      loadPrisma: async () => prisma,
      readHiddenPin: async () => 'unused',
      writeSuccess: (line) => output.push(line),
      writeFailure: (line) => output.push(line),
    });

    expect(result).toBe(false);
    expect(output).toEqual(['Unable to create administrator.']);
    expect(output.join('\n')).not.toContain('postgresql://secret');
    expect(prisma.disconnects).toBe(1);
  });

  it('converts an unexpected terminal CLI rejection into generic failure output and exit code one', async () => {
    const output: string[] = [];
    const exitCodes: number[] = [];

    await finishCreateAdministratorCommand(
      Promise.reject(new Error('raw connection failure with PIN 314159')),
      (line) => output.push(line),
      (code) => exitCodes.push(code),
    );

    expect(output).toEqual(['Unable to create administrator.']);
    expect(exitCodes).toEqual([1]);
    expect(output.join('\n')).not.toContain('314159');
  });
});
