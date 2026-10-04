import { currentUser, requireUserResponse } from '@/lib/auth';
import { isCustomerLanguage } from '@/domain/customer-info/customer-info';
import { getCustomerInfoCard } from '@/repositories/customer-info-repository';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';
import { incrementMetric } from '@/infrastructure/observability/metrics';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const { id } = await params;
  const productId = Number(id);
  const language = new URL(req.url).searchParams.get('lang') ?? 'en';
  if (!Number.isSafeInteger(productId) || productId <= 0 || !isCustomerLanguage(language)) {
    return Response.json({ error: 'invalid request' }, { status: 400 });
  }

  // 404: inactive, private, or missing product. 204: no complete card in this language.
  const result = await getCustomerInfoCard(productId, language);
  if (result.status === 'not_found') return Response.json({ error: 'product not found' }, { status: 404 });
  if (result.status === 'unavailable') {
    incrementMetric('customer_info.unavailable');
    logEvent('customer_info_unavailable', { requestId: requestId(req), userId: user.id, productId, language });
    return new Response(null, { status: 204, headers: { 'x-available-languages': result.available_languages.join(',') } });
  }
  return Response.json(result.card, { headers: { 'cache-control': 'private, no-store' } });
}
