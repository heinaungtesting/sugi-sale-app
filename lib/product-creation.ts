import { normalizeProductQuery } from './sugi-domain';

const MAX_ALIASES = 24;
const MAX_ALIAS_LENGTH = 60;

type QuickProductCreationInput = {
  productName: string;
  pointValue: number;
  aliases?: unknown;
  parentProductId?: number | null;
  variantLabel?: string | null;
};

export type QuickProductCreationPlan =
  | {
      mode: 'standalone';
      productName: string;
      pointValue: number;
      aliases: string[];
    }
  | {
      mode: 'variant';
      parentProductId: number;
      variantLabel: string;
      pointValue: number;
      aliases: string[];
    };

function normalizeDisplayText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function suppliedAliases(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/[,、\n]+/);
  return values.map(normalizeDisplayText).filter(Boolean);
}

export function normalizeQuickProductAliases(name: string, aliases: unknown): string[] {
  const normalizedName = normalizeDisplayText(name).toLowerCase();
  const compactName = normalizeProductQuery(normalizedName);
  const tokens = normalizedName.split(/[\s/・()（）\[\]【】_-]+/).filter((token) => token.length >= 2);
  const candidates = [normalizedName, compactName, ...tokens, ...suppliedAliases(aliases)];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const display = normalizeDisplayText(candidate).toLowerCase();
    const key = normalizeProductQuery(display);
    if (!display || display.length > MAX_ALIAS_LENGTH || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(display);
    if (result.length >= MAX_ALIASES) break;
  }
  return result;
}

export function buildQuickProductPlan(input: QuickProductCreationInput): QuickProductCreationPlan | null {
  const productName = normalizeDisplayText(input.productName);
  const pointValue = Math.floor(Number(input.pointValue));
  if (!Number.isFinite(pointValue) || pointValue <= 0 || pointValue > 9999) return null;

  if (input.parentProductId !== undefined && input.parentProductId !== null) {
    const parentProductId = Number(input.parentProductId);
    const variantLabel = normalizeDisplayText(input.variantLabel ?? productName);
    if (!Number.isInteger(parentProductId) || parentProductId <= 0) return null;
    if (variantLabel.length < 1 || variantLabel.length > 80) return null;
    return {
      mode: 'variant',
      parentProductId,
      variantLabel,
      pointValue,
      aliases: normalizeQuickProductAliases(variantLabel, input.aliases),
    };
  }

  if (productName.length < 2 || productName.length > 120) return null;
  return {
    mode: 'standalone',
    productName,
    pointValue,
    aliases: normalizeQuickProductAliases(productName, input.aliases),
  };
}
