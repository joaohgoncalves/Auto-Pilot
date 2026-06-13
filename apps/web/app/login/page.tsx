'use client';

import { useState } from 'react';
import { api, saveAuth, type AuthResponse } from '../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function login() {
    try {
      setLoading(true);
      setError('');
      const data = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, tenantSlug })
      });
      saveAuth(data);
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 460, margin: '80px auto', padding: 24 }}>
      <div className="card grid">
        <span className="badge">AutoPilotOps</span>
        <h1>Self-Healing Operations</h1>
        <p className="muted">Sessão via cookies httpOnly. O frontend não grava access token em localStorage.</p>
        <label>Email<input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Your password" /></label>
        <label>Tenant slug<input className="input" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} placeholder="your-tenant" /></label>
        {error && <p style={{ color: '#fca5a5' }}>{error}</p>}
        <button className="btn" onClick={login} disabled={loading}>{loading ? 'Entrando...' : 'Login'}</button>
      </div>
    </main>
  );
}
