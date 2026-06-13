'use client';

import { useEffect, useState } from 'react';
import { apiPage, requireBrowserAuth, type ActionRow } from '../lib/api';

export default function ActionsPage() {
  const [items, setItems] = useState<ActionRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { requireBrowserAuth(); apiPage<ActionRow>('/actions').then((data) => setItems(data.items)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar actions.')); }, []);
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <a className="badge" href="/">← Dashboard</a>
      <h1>Actions</h1>
      {error && <div className="card danger">{error}</div>}
      {items.length === 0 && <div className="card muted">Nenhuma action encontrada.</div>}
      <div className="card">
        <table className="table"><thead><tr><th>Title</th><th>Type</th><th>Risk</th><th>Status</th><th>Error</th><th>Created</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.type}</td><td>{item.riskLevel}</td><td><span className="badge">{item.status}</span></td><td>{item.errorMessage ?? '-'}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
