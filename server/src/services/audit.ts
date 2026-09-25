import { run } from '../db/index.js';
import type { AuthUser } from '../auth.js';

export function audit(user: Pick<AuthUser, 'id' | 'tenantId'> | null, tenantId: number, action: string, entity?: string, entityId?: number | bigint | null, detail?: unknown, ip?: string) {
  run(
    'INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?)',
    tenantId,
    user?.id ?? null,
    action,
    entity ?? null,
    entityId == null ? null : Number(entityId),
    detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
    ip ?? null,
  );
}
