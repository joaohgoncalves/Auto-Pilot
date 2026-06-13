'use client';

import { useEffect, useState } from 'react';
import { api, clearAuth, requireBrowserAuth, type Summary } from './lib/api';

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      setError('');
      setSummary(await api<Summary>('/dashboard/summary'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar dashboard. Faça login em /login.');
    } finally {
      setLoading(false);
    }
  }

  async function runTechnicalDemo() {
    await api('/demo/technical-regression', { method: 'POST', body: '{}' });
    await load();
  }

  async function runRetailDemo() {
    await api('/demo/retail-stockout', { method: 'POST', body: '{}' });
    await load();
  }

  async function logout() {
    await clearAuth();
    window.location.href = '/login';
  }

  useEffect(() => { requireBrowserAuth(); void load(); }, []);

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <span className="badge">AutoPilotOps</span>
          <h1>Autonomous Operations Engine</h1>
          <p className="muted">Detecta sinal, entende risco, aplica política, executa ação e audita tudo.</p>
        </div>
        <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a className="btn secondary" href="/signals">Signals</a>
          <a className="btn secondary" href="/actions">Actions</a>
          <a className="btn secondary" href="/approvals">Approvals</a>
          <a className="btn secondary" href="/incidents">Incidents</a>
          <a className="btn secondary" href="/tasks">Tasks</a>
          <a className="btn secondary" href="/rules">Rules</a>
          <a className="btn secondary" href="/audit">Audit</a>
          <button className="btn secondary" onClick={logout}>Logout</button>
        </nav>
      </header>

      {loading && <div className="card" style={{ marginTop: 24 }}>Carregando...</div>}
      {error && <div className="card" style={{ marginTop: 24, color: '#fca5a5' }}>{error}</div>}

      <section className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 24 }}>
        {[
          ['Signals', summary?.signals ?? 0],
          ['Open incidents', summary?.incidentsOpen ?? 0],
          ['Pending approvals', summary?.approvalsPending ?? 0],
          ['Purchase recommendations', summary?.recommendationsOpen ?? 0],
          ['Open tasks', summary?.tasksOpen ?? 0],
          ['Failed actions', summary?.failedActions ?? 0]
        ].map(([label, value]) => (
          <div className="card" key={label}>
            <p className="muted">{label}</p>
            <h2 style={{ fontSize: 42, margin: 0 }}>{value}</h2>
          </div>
        ))}
      </section>

      <section className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 24 }}>
        <div className="card grid">
          <span className="badge">Enterprise Demo</span>
          <h2>Erro pós-deploy</h2>
          <p className="muted">Cria incidente, aprovação de rollback, notificação e recovery check. Rollback externo permanece simulado.</p>
          <button className="btn" onClick={runTechnicalDemo}>Run technical regression demo</button>
        </div>

        <div className="card grid">
          <span className="badge">Retail Demo</span>
          <h2>Risco de ruptura de estoque</h2>
          <p className="muted">Gera recomendação de compra, tarefa operacional, notificação simulada e follow-up.</p>
          <button className="btn" onClick={runRetailDemo}>Run retail stockout demo</button>
        </div>
      </section>
    </main>
  );
}
