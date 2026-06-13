'use client';

import { useEffect, useState } from 'react';
import { api, apiPage, requireBrowserAuth, type ApprovalRow } from '../lib/api';

export default function ApprovalsPage() {
  const [items, setItems] = useState<ApprovalRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      setItems((await apiPage<ApprovalRow>('/approvals')).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar approvals.');
    } finally {
      setLoading(false);
    }
  }

  async function approve(id: string) { await api(`/approvals/${id}/approve`, { method: 'POST', body: '{}' }); await load(); }
  async function reject(id: string) { await api(`/approvals/${id}/reject`, { method: 'POST', body: '{}' }); await load(); }

  useEffect(() => { requireBrowserAuth(); void load(); }, []);
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <a className="badge" href="/">← Dashboard</a>
      <h1>Approvals</h1>
      {loading && <div className="card">Carregando...</div>}
      {error && <div className="card danger">{error}</div>}
      {!loading && items.length === 0 && <div className="card muted">Nenhuma aprovação encontrada.</div>}
      <div className="card">
        <table className="table"><thead><tr><th>Title</th><th>Status</th><th>Required role</th><th>Expires</th><th>Reason</th><th>Action</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td>{item.title}</td><td><span className="badge">{item.status}</span></td><td>{item.minApproverRole}</td><td>{item.expiresAt ? new Date(item.expiresAt).toLocaleString() : '-'}</td><td>{item.reason}</td><td>{item.status === 'PENDING' && <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={() => approve(item.id)}>Approve</button><button className="btn secondary" onClick={() => reject(item.id)}>Reject</button></div>}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
