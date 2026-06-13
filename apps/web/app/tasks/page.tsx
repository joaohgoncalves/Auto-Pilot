'use client';

import { useEffect, useState } from 'react';
import { apiPage, requireBrowserAuth, type TaskRow } from '../lib/api';

export default function TasksPage() {
  const [items, setItems] = useState<TaskRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { requireBrowserAuth(); apiPage<TaskRow>('/tasks').then((data) => setItems(data.items)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar tasks.')); }, []);
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <a className="badge" href="/">← Dashboard</a>
      <h1>Tasks</h1>
      {error && <div className="card danger">{error}</div>}
      {items.length === 0 && <div className="card muted">Nenhuma task encontrada.</div>}
      <div className="card">
        <table className="table"><thead><tr><th>Title</th><th>Status</th><th>Assignee</th><th>Due</th><th>Description</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td>{item.title}</td><td><span className="badge">{item.status}</span></td><td>{item.assignee ?? '-'}</td><td>{item.dueAt ? new Date(item.dueAt).toLocaleString() : '-'}</td><td>{item.description}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
