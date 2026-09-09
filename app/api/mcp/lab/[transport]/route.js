import { createMcpHandler } from 'mcp-handler';
import { registerLabTools } from '@/lib/mcp/servers';

const handler = createMcpHandler(
  (server) => registerLabTools(server),
  {},
  { basePath: '/api/mcp/lab' }
);

export const dynamic = 'force-dynamic';
export { handler as GET, handler as POST, handler as DELETE };
