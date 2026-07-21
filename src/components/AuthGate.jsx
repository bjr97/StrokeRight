import React, { useState } from 'react';
import { storage, keys } from '../lib/storage.js';
import { Button, Card, Input } from './ui.jsx';

export default function AuthGate({ onAuth, tournament }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Enter your name');
    if (!tournament) return setErr('No active tournament yet — ask an admin to set one up.');
    const expected = tournament.poolCode;
    if (code.trim().toLowerCase() !== expected.toLowerCase()) {
      return setErr('Pool code incorrect');
    }
    const session = { name: name.trim(), authedAt: Date.now() };
    storage.set(keys.session, session);
    onAuth(session);
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-accent" />
          <h1 className="text-xl font-semibold">
            <span className="text-text">Stroke</span><span className="text-accent">Right</span>
          </h1>
        </div>
        <p className="text-sm text-muted mb-6">
          {tournament ? tournament.name : 'No active tournament'}
        </p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Your name</label>
            <Input value={name} onChange={setName} placeholder="e.g. Charles D." />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Pool code</label>
            <Input value={code} onChange={setCode} placeholder="ask the pool admin" />
          </div>
          {err && <div className="text-sm text-danger">{err}</div>}
          <Button type="submit" className="w-full">Enter Pool</Button>
        </form>

        <div className="mt-4 text-xs text-muted text-center">
          Admin? <button onClick={() => onAuth({ name: 'Admin', isAdmin: 'pending' })} className="text-accent hover:underline">Admin login →</button>
        </div>
      </Card>
    </div>
  );
}
