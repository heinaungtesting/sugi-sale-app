import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';
import { logActivity } from '@/lib/sugi-activity';
import { validateHermesSettings } from '@/domain/customer-info/hermes';
import { getHermesSettings, publicHermesSettings, saveHermesSettings } from '@/repositories/app-settings-repository';

export async function GET() {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json(publicHermesSettings(await getHermesSettings()));
}

export async function PUT(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const validation = validateHermesSettings(await req.json().catch(() => null));
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

  const saved = await saveHermesSettings(validation.value, user.id);
  await logActivity({
    userId: user.id,
    actorUserId: user.id,
    action: 'admin_hermes_settings_updated',
    summary: `Hermes連携先を更新: ${saved.endpoint_url ?? '未設定'}`,
    details: { endpoint_url: saved.endpoint_url, token_changed: validation.value.token !== undefined },
  });
  return Response.json(publicHermesSettings(saved));
}
