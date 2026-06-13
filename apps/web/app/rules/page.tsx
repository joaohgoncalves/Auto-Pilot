'use client';

import { useEffect, useState } from 'react';
import { apiPage, requireBrowserAuth, type RuleRow } from '../lib/api';

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function RulesPage() {
  const [items, setItems] = useState<RuleRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { requireBrowserAuth(); apiPage<RuleRow>('/rules').then((data) => setItems(data.items)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar rules.')); }, []);
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <a className="badge" href="/">← Dashboard</a>
      <h1>Rules / Playbooks</h1>
      {error && <div className="card danger">{error}</div>}
      {items.length === 0 && <div className="card muted">Nenhuma rule encontrada.</div>}
      <div className="grid">
        {items.map((rule) => (
          <article className="card grid" key={rule.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2>{rule.name}</h2>
                <p className="muted">{rule.description ?? 'Sem descrição'}</p>
              </div>
              <span className="badge">{rule.isActive ? 'ACTIVE' : 'DISABLED'} · P{rule.priority}</span>
            </div>
            <p><strong>Trigger:</strong> {rule.triggerType}</p>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <pre>{prettyJson(rule.conditions)}</pre>
              <pre>{prettyJson(rule.actions)}</pre>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
