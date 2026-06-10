import { currentUser, requireUserResponse } from '@/lib/auth';
import { deleteSaleById, updateSaleQuantity } from '@/lib/sugi-db';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const { id } = await params;
  const saleId = Number(id);
  const body = await req.json().catch(() => ({}));
  const delta = Number(body.delta);
  if (!Number.isInteger(saleId) || saleId <= 0 || !Number.isInteger(delta) || delta === 0) return Response.json({ error: 'invalid request' }, { status: 400 });
  const sale = await updateSaleQuantity(user.id, saleId, delta);
  if (!sale) return Response.json({ error: 'sale not found' }, { status: 404 });
  return Response.json(sale);
}
