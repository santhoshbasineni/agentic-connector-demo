import { createMcpHandler } from 'mcp-handler';
import { registerPayerTools } from '@/lib/mcp/servers';

const handler = createMcpHandler(
  (server) => registerPayerTools(server),
  {},
  { basePath: '/api/mcp/payer' }
);

export const dynamic = 'force-dynamic';
export { handler as GET, handler as POST, handler as DELETE };
