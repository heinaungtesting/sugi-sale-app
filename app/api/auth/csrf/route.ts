export async function GET() {
  return Response.json({ ok: true, csrf: 'disabled' });
}
