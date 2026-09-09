import { createMcpHandler } from 'mcp-handler';
import { registerOrgTools } from '@/lib/mcp/servers';

const handler = createMcpHandler(
  (server) => registerOrgTools(server),
  {},
  { basePath: '/api/mcp/org' }
);

export const dynamic = 'force-dynamic';
export { handler as GET, handler as POST, handler as DELETE };
