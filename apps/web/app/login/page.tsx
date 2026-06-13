'use client';

import { useState } from 'react';
import { api, saveAuth, type AuthResponse } from '../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('admin@autopilotops.dev');
  const [password, setPassword] = useState('Admin@123456');
  const [tenantSlug, setTenantSlug] = useState('autopilotops-demo');
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
        <label>Email<input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" /></label>
        <label>Tenant slug<input className="input" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} /></label>
        {error && <p style={{ color: '#fca5a5' }}>{error}</p>}
        <button className="btn" onClick={login} disabled={loading}>{loading ? 'Entrando...' : 'Login'}</button>
        <p className="muted">Usuários seed: admin, manager, operator e viewer em @autopilotops.dev.</p>
      </div>
    </main>
  );
}
