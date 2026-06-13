'use client';

import { useEffect, useState } from 'react';
import { apiPage, requireBrowserAuth, type RecommendationRow } from '../lib/api';

export default function RecommendationsPage() {
  const [items, setItems] = useState<RecommendationRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { requireBrowserAuth(); apiPage<RecommendationRow>('/purchase-recommendations').then((data) => setItems(data.items)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar recommendations.')); }, []);
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 32 }}>
      <a className="badge" href="/">← Dashboard</a>
      <h1>Purchase Recommendations</h1>
      {error && <div className="card danger">{error}</div>}
      {items.length === 0 && <div className="card muted">Nenhuma recomendação encontrada.</div>}
      <div className="card">
        <table className="table"><thead><tr><th>Product</th><th>Stock</th><th>Suggested</th><th>Risk</th><th>Status</th><th>Supplier</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td>{item.productName}</td><td>{item.currentStock}</td><td>{item.suggestedQuantity}</td><td>{item.riskLevel}</td><td>{item.status}</td><td>{item.supplierName ?? '-'}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
