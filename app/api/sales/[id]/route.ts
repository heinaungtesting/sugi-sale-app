import { currentUser, requireUserResponse } from '@/lib/auth';
import { deleteSaleById, updateSalePoints, updateSaleQuantity } from '@/lib/sugi-db';
import { requireCsrf } from '@/lib/csrf';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const { id } = await params;
  const saleId = Number(id);
  if (!Number.isInteger(saleId) || saleId <= 0) return Response.json({ error: 'invalid sale id' }, { status: 400 });
  const deleted = await deleteSaleById(user.id, saleId);
  if (!deleted) return Response.json({ error: 'sale not found' }, { status: 404 });
  return Response.json(deleted);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const { id } = await params;
  const saleId = Number(id);
  const body = await req.json().catch(() => ({}));
  if (body.point_value !== undefined) {
    const pointValue = Number(body.point_value);
    if (!Number.isInteger(saleId) || saleId <= 0 || !Number.isFinite(pointValue) || pointValue <= 0) return Response.json({ error: 'invalid request' }, { status: 400 });
    const sale = await updateSalePoints(user.id, saleId, pointValue);
    if (!sale) return Response.json({ error: 'sale not found' }, { status: 404 });
    return Response.json(sale);
  }
  const delta = Number(body.delta);
  if (!Number.isInteger(saleId) || saleId <= 0 || !Number.isInteger(delta) || delta === 0) return Response.json({ error: 'invalid request' }, { status: 400 });
  const sale = await updateSaleQuantity(user.id, saleId, delta);
  if (!sale) return Response.json({ error: 'sale not found' }, { status: 404 });
  return Response.json(sale);
}
