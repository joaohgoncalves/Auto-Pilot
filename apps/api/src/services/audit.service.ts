import { audit, auditWithTx, type AuditInput } from '../lib/audit.js';
import type { Prisma } from '@prisma/client';

export class AuditService {
  constructor(private readonly tx?: Prisma.TransactionClient) {}

  write(input: AuditInput) {
    return this.tx ? auditWithTx(this.tx, input) : audit(input);
  }
}
