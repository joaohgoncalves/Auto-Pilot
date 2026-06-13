'use client';

import { useEffect, useState } from 'react';
import { apiPage, requireBrowserAuth, type AuditRow } from '../lib/api';

export default function AuditPage() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { requireBrowserAuth(); apiPage<AuditRow>('/audit').then((data) => setItems(data.items)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar auditoria.')); }, []);
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <a className="badge" href="/">← Dashboard</a>
      <h1>Audit</h1>
      {error && <div className="card danger">{error}</div>}
      {items.length === 0 && <div className="card muted">Nenhum log encontrado.</div>}
      <div className="card">
        <table className="table"><thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Message</th><th>Correlation</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.actor}</td><td>{item.event}</td><td>{item.message}</td><td>{item.correlationId ?? item.requestId ?? '-'}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
