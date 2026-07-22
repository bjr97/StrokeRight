import React, { useState } from 'react';
import Trends from './Trends.jsx';
import Compare from './Compare.jsx';

// Shares one nav slot between Trends and Compare — a plain toggle over the
// two existing pages, not an actual merge of their logic.
export default function Analysis({ initialTab, ...props }) {
  const [tab, setTab] = useState(initialTab || 'trends'); // 'trends' | 'compare'

  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 pt-6 flex gap-1">
        {[{ value: 'trends', label: 'Trends' }, { value: 'compare', label: 'Compare' }].map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              tab === t.value ? 'bg-accent text-bg border-accent' : 'border-border text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'trends' ? <Trends {...props} /> : <Compare {...props} />}
    </div>
  );
}
