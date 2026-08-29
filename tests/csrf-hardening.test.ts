import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { verifyCsrfRequest } from '../lib/csrf';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type UnsafeHandler = { method: string; source: string };

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function stringValue(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function importsCsrfGuard(text: string, path: string): boolean {
  const syntax = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return syntax.statements.some((statement) =>
    ts.isImportDeclaration(statement)
    && stringValue(statement.moduleSpecifier) === '@/lib/csrf'
    && Boolean(statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some((element) => element.name.text === 'requireCsrf')),
  );
}

function directlyReturnsIdentifier(node: ts.Statement, name: string): boolean {
  const statement = ts.isBlock(node) && node.statements.length === 1 ? node.statements[0] : node;
  if (!ts.isReturnStatement(statement) || !statement.expression) return false;
  return ts.isIdentifier(statement.expression) && statement.expression.text === name;
}

function hasEffectiveCsrfGuard(handlerSource: string): boolean {
  const syntax = ts.createSourceFile('handler.ts', handlerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let body: ts.Block | undefined;
  function findHandlerBody(node: ts.Node): void {
    if (body) return;
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
      && node.body && ts.isBlock(node.body)) {
      body = node.body;
      return;
    }
    node.forEachChild(findHandlerBody);
  }
  findHandlerBody(syntax);
  if (!body || body.statements.length < 2) return false;

  const declarationStatement = body.statements[0];
  const rejectionStatement = body.statements[1];
  if (!ts.isVariableStatement(declarationStatement)
    || declarationStatement.declarationList.declarations.length !== 1
    || !ts.isIfStatement(rejectionStatement)) return false;

  const declaration = declarationStatement.declarationList.declarations[0];
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer
    || !ts.isCallExpression(declaration.initializer)
    || !ts.isIdentifier(declaration.initializer.expression)
    || declaration.initializer.expression.text !== 'requireCsrf'
    || declaration.initializer.arguments.length !== 1
    || !ts.isIdentifier(declaration.initializer.arguments[0])
    || declaration.initializer.arguments[0].text !== 'req') return false;

  const guardVariable = declaration.name.text;
  return ts.isIdentifier(rejectionStatement.expression)
    && rejectionStatement.expression.text === guardVariable
    && directlyReturnsIdentifier(rejectionStatement.thenStatement, guardVariable);
}

function serviceWorkerPostMarkers(worker: string): boolean[] {
  const syntax = ts.createSourceFile('sw.js', worker, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const markedPosts: boolean[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch'
      && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      const options = node.arguments[1];
      const method = options.properties.find((property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === 'method');
      if (!method || stringValue(method.initializer) !== 'POST') {
        node.forEachChild(visit);
        return;
      }
      const headers = options.properties.find((property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === 'headers');
      const marked = Boolean(headers && ts.isObjectLiteralExpression(headers.initializer)
        && headers.initializer.properties.some((property) => ts.isPropertyAssignment(property)
          && propertyName(property.name) === 'X-Sugi-Request'
          && stringValue(property.initializer) === 'same-origin'));
      markedPosts.push(marked);
    }
    node.forEachChild(visit);
  }
  visit(syntax);
  return markedPosts;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  ));
}

function unsafeHandlers(path: string): UnsafeHandler[] {
  const text = source(path);
  const syntax = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Map<string, ts.Node>();
  const handlers: UnsafeHandler[] = [];

  for (const statement of syntax.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
      if (hasExportModifier(statement) && UNSAFE_METHODS.has(statement.name.text)) {
        handlers.push({ method: statement.name.text, source: statement.getText(syntax) });
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declarations.set(declaration.name.text, declaration);
        if (hasExportModifier(statement) && UNSAFE_METHODS.has(declaration.name.text)) {
          handlers.push({ method: declaration.name.text, source: declaration.getText(syntax) });
        }
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const method = element.name.text;
        if (!UNSAFE_METHODS.has(method)) continue;
        const localName = element.propertyName?.text ?? method;
        const declaration = statement.moduleSpecifier ? undefined : declarations.get(localName);
        handlers.push({ method, source: declaration?.getText(syntax) ?? '' });
      }
    }
  }
  return handlers;
}

const unsafeRoutes = (directory = join(process.cwd(), 'app/api')): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return unsafeRoutes(path);
    if (entry.name !== 'route.ts') return [];
    const relativePath = path.slice(process.cwd().length + 1).replaceAll('\\', '/');
    return unsafeHandlers(relativePath).length > 0
      ? [path.slice(process.cwd().length + 1).replaceAll('\\', '/')]
      : [];
  });

const sameOriginHeaders = {
  host: 'localhost',
  origin: 'http://localhost',
  'sec-fetch-site': 'same-origin',
  'x-sugi-request': 'same-origin',
};

describe('tokenless same-origin mutation guard', () => {
  it('accepts an allowed same-origin request with the explicit mutation marker', () => {
    const request = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: sameOriginHeaders,
    });
    expect(verifyCsrfRequest(request)).toBe(true);
  });

  it('rejects unsafe requests without the mutation marker or browser source', () => {
    const missingMarker = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'http://localhost' },
    });
    const missingSource = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: { host: 'localhost', 'x-sugi-request': 'same-origin' },
    });
    expect(verifyCsrfRequest(missingMarker)).toBe(false);
    expect(verifyCsrfRequest(missingSource)).toBe(false);
  });

  it('accepts the public HTTPS origin behind the internal Tailscale HTTP proxy', () => {
    const request = new Request('http://100.111.161.73:8080/api/products', {
      method: 'POST',
      headers: {
        host: 'herme-agents.tail71ac56.ts.net',
        origin: 'https://herme-agents.tail71ac56.ts.net',
        'sec-fetch-site': 'same-origin',
        'x-sugi-request': 'same-origin',
      },
    });
    expect(verifyCsrfRequest(request)).toBe(true);
  });

  it('rejects cross-origin and unlisted-host requests', () => {
    const crossOrigin = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: { ...sameOriginHeaders, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    const badHost = new Request('https://evil.example/api/sales', {
      method: 'POST',
      headers: { ...sameOriginHeaders, host: 'evil.example', origin: 'https://evil.example' },
    });
    expect(verifyCsrfRequest(crossOrigin)).toBe(false);
    expect(verifyCsrfRequest(badHost)).toBe(false);
  });

  it('requires the browser source and target to be the same allowed host', () => {
    const request = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: {
        ...sameOriginHeaders,
        origin: 'https://herme-agents.tail71ac56.ts.net',
      },
    });
    expect(verifyCsrfRequest(request)).toBe(false);
  });

  it('recognizes the exact system-provided Vercel deployment host', () => {
    const previous = process.env.VERCEL_URL;
    process.env.VERCEL_URL = 'sugi-preview-abc.vercel.app';
    try {
      const request = new Request('https://sugi-preview-abc.vercel.app/api/sales', {
        method: 'POST',
        headers: {
          host: 'sugi-preview-abc.vercel.app',
          origin: 'https://sugi-preview-abc.vercel.app',
          'sec-fetch-site': 'same-origin',
          'x-sugi-request': 'same-origin',
        },
      });
      expect(verifyCsrfRequest(request)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.VERCEL_URL;
      else process.env.VERCEL_URL = previous;
    }
  });

  it('recognizes the exact system-provided Vercel branch host', () => {
    const previous = process.env.VERCEL_BRANCH_URL;
    process.env.VERCEL_BRANCH_URL = 'sugi-git-security-team.vercel.app';
    try {
      const request = new Request('https://sugi-git-security-team.vercel.app/api/sales', {
        method: 'POST',
        headers: {
          host: 'sugi-git-security-team.vercel.app',
          origin: 'https://sugi-git-security-team.vercel.app',
          'sec-fetch-site': 'same-origin',
          'x-sugi-request': 'same-origin',
        },
      });
      expect(verifyCsrfRequest(request)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.VERCEL_BRANCH_URL;
      else process.env.VERCEL_BRANCH_URL = previous;
    }
  });

  it('recognizes the exact system-provided Vercel production host', () => {
    const previous = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'sugi.example.com';
    try {
      const request = new Request('https://sugi.example.com/api/sales', {
        method: 'POST',
        headers: {
          host: 'sugi.example.com',
          origin: 'https://sugi.example.com',
          'sec-fetch-site': 'same-origin',
          'x-sugi-request': 'same-origin',
        },
      });
      expect(verifyCsrfRequest(request)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      else process.env.VERCEL_PROJECT_PRODUCTION_URL = previous;
    }
  });

  it('recognizes an exact custom host from SUGI_ALLOWED_HOSTS', () => {
    const previous = process.env.SUGI_ALLOWED_HOSTS;
    process.env.SUGI_ALLOWED_HOSTS = 'custom-sugi.example.com';
    try {
      const request = new Request('https://custom-sugi.example.com/api/sales', {
        method: 'POST',
        headers: {
          host: 'custom-sugi.example.com',
          origin: 'https://custom-sugi.example.com',
          'sec-fetch-site': 'same-origin',
          'x-sugi-request': 'same-origin',
        },
      });
      expect(verifyCsrfRequest(request)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.SUGI_ALLOWED_HOSTS;
      else process.env.SUGI_ALLOWED_HOSTS = previous;
    }
  });

  it('contains no signed double-submit token machinery', () => {
    const server = source('lib/csrf.ts');
    const client = source('lib/csrf-client.ts');
    const endpoint = source('app/api/auth/csrf/route.ts');
    const login = source('app/api/auth/login/route.ts');
    expect(server).not.toContain('createHmac');
    expect(server).not.toContain('sugi_csrf');
    expect(server).not.toContain('x-csrf-token');
    expect(server).not.toContain('setCsrfCookie');
    expect(client).not.toContain('/api/auth/csrf');
    expect(client).not.toContain('x-csrf-token');
    expect(endpoint).not.toContain('setCsrfCookie');
    expect(endpoint).not.toContain('Set-Cookie');
    expect(login).not.toContain('setCsrfCookie');
  });

  it('keeps the same-origin guard on every mutation route, including login', () => {
    const routes = unsafeRoutes();
    expect(routes).toContain('app/api/auth/login/route.ts');
    for (const path of routes) {
      expect(importsCsrfGuard(source(path), path), `${path} must import the real CSRF guard`).toBe(true);
      for (const handler of unsafeHandlers(path)) {
        expect(
          hasEffectiveCsrfGuard(handler.source),
          `${path} ${handler.method} must call and return the CSRF guard`,
        ).toBe(true);
      }
    }
  });

  it('adds the mutation marker to service-worker replay requests', () => {
    const worker = source('public/sw.js');
    expect(serviceWorkerPostMarkers(worker)).toEqual([true, true]);
  });

  it('keeps explicit browser submit handlers for admin CRUD', () => {
    const adminClient = source('components/AdminClient.tsx');
    expect(adminClient).toContain('submitAdminForm');
    expect(adminClient).toContain('event.preventDefault()');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveProduct)}');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveVariant)}');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveUser)}');
  });
});
