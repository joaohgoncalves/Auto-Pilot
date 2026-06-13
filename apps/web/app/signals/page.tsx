'use client';

import { useEffect, useState } from 'react';
import { apiPage, requireBrowserAuth, type SignalRow } from '../lib/api';

export default function SignalsPage() {
  const [items, setItems] = useState<SignalRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { requireBrowserAuth(); apiPage<SignalRow>('/signals').then((data) => setItems(data.items)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar signals.')); }, []);
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <a className="badge" href="/">← Dashboard</a>
      <h1>Signals</h1>
      {error && <div className="card danger">{error}</div>}
      {items.length === 0 && <div className="card muted">Nenhum signal encontrado.</div>}
      <div className="card">
        <table className="table"><thead><tr><th>Type</th><th>Entity</th><th>Severity</th><th>Status</th><th>Risk</th><th>Diagnosis</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td>{item.type}</td><td>{item.entityId}</td><td>{item.severity}</td><td><span className="badge">{item.status}</span></td><td>{item.riskLevel ?? '-'}</td><td>{item.diagnosis ?? 'Processing...'}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
