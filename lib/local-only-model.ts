export type LocalProfile = {
  id: 'local';
  displayName: string;
  createdAt: string;
};

export type LocalSale = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  pointsPerItem: number;
  createdAt: string;
  saleDate: string;
};

export type LocalCustomProduct = {
  id: string;
  productName: string;
  pointValue: number;
  aliases: string[];
  createdAt: string;
};

export type LocalBackup = {
  version: 1;
  exportedAt: string;
  profile: LocalProfile | null;
  sales: LocalSale[];
  customProducts: LocalCustomProduct[];
};

export function tokyoDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function summarizeSales(sales: LocalSale[], dateKey: string) {
  const selected = sales
    .filter((sale) => sale.saleDate === dateKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    sales: selected,
    totalItems: selected.reduce((sum, sale) => sum + sale.quantity, 0),
    totalPoints: selected.reduce((sum, sale) => sum + sale.quantity * sale.pointsPerItem, 0),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isProfile(value: unknown): value is LocalProfile {
  return isRecord(value)
    && value.id === 'local'
    && typeof value.displayName === 'string'
    && value.displayName.trim().length > 0
    && value.displayName.length <= 80
    && isIsoDate(value.createdAt);
}

function isSale(value: unknown): value is LocalSale {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.productId === 'string'
    && typeof value.productName === 'string'
    && value.productName.trim().length > 0
    && typeof value.quantity === 'number'
    && Number.isInteger(value.quantity)
    && value.quantity > 0
    && typeof value.pointsPerItem === 'number'
    && Number.isFinite(value.pointsPerItem)
    && value.pointsPerItem > 0
    && isIsoDate(value.createdAt)
    && typeof value.saleDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value.saleDate);
}

function isCustomProduct(value: unknown): value is LocalCustomProduct {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.productName === 'string'
    && value.productName.trim().length > 0
    && typeof value.pointValue === 'number'
    && Number.isFinite(value.pointValue)
    && value.pointValue > 0
    && Array.isArray(value.aliases)
    && value.aliases.every((alias) => typeof alias === 'string')
    && isIsoDate(value.createdAt);
}

export function validateLocalBackup(value: unknown): { ok: true; backup: LocalBackup } | { ok: false; error: string } {
  if (!isRecord(value) || value.version !== 1) return { ok: false, error: '対応していないバックアップ形式です' };
  if (!isIsoDate(value.exportedAt)) return { ok: false, error: '書き出し日時が不正です' };
  if (value.profile !== null && !isProfile(value.profile)) return { ok: false, error: 'プロフィールが不正です' };
  if (!Array.isArray(value.sales) || !value.sales.every(isSale)) return { ok: false, error: '販売記録が不正です' };
  if (!Array.isArray(value.customProducts) || !value.customProducts.every(isCustomProduct)) {
    return { ok: false, error: 'カスタム商品が不正です' };
  }
  return { ok: true, backup: value as LocalBackup };
}
