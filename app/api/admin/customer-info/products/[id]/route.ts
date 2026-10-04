import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';
import { isProductType, isRiskClass } from '@/domain/customer-info/customer-info';
import { setProductClassification } from '@/repositories/customer-info-repository';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  const productId = Number(id);
  const body = await req.json().catch(() => null);
  const riskClass = body?.risk_class === null || body?.risk_class === '' ? null : body?.risk_class;
  if (!Number.isSafeInteger(productId) || productId <= 0 || !isProductType(body?.product_type) || (riskClass !== null && !isRiskClass(riskClass))) {
    return Response.json({ error: 'invalid request' }, { status: 400 });
  }
  const updated = await setProductClassification(productId, body.product_type, riskClass, { id: user.id, username: user.username });
  if (!updated) return Response.json({ error: 'product not found' }, { status: 404 });
  return Response.json({ product_id: productId, product_type: body.product_type, risk_class: riskClass });
}
