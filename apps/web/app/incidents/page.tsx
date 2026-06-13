'use client';

import { useEffect, useState } from 'react';
import { apiPage, requireBrowserAuth, type IncidentRow } from '../lib/api';

export default function IncidentsPage() {
  const [items, setItems] = useState<IncidentRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { requireBrowserAuth(); apiPage<IncidentRow>('/incidents').then((data) => setItems(data.items)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar incidents.')); }, []);
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <a className="badge" href="/">← Dashboard</a>
      <h1>Incidents</h1>
      {error && <div className="card danger">{error}</div>}
      {items.length === 0 && <div className="card muted">Nenhum incidente encontrado.</div>}
      <div className="card">
        <table className="table"><thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Cause</th><th>Fix</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.severity}</td><td><span className="badge">{item.status}</span></td><td>{item.probableCause}</td><td>{item.recommendedFix ?? '-'}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
