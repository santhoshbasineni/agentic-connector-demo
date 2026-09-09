import { setDisposition } from '@/lib/actions';

export const dynamic = 'force-dynamic';

// DR (Disposition Response) — physician confirms the AI suggestion or redirects
export async function POST(request, { params }) {
  const { action } = await request.json();
  const result = setDisposition(params.id, action);
  if (result.error) {
    const status = result.error === 'case not found' ? 404 : result.error.startsWith('action') ? 400 : 409;
    return Response.json(result, { status });
  }
  return Response.json(result);
}
