import { useEffect, useMemo, useRef, useState } from 'react';

// Brand / supplier picker drawn inside the page: a box to type in, with
// the matching brands listed underneath. It replaced a <select> whose
// open list Chrome drew empty on the shop's computer (Sally, 5 Nov 2026:
// "when I'm doing a custom item ... the brand supplier is blank with the
// drop down"). The open list of a <select> is drawn by the browser
// outside the page, so the POS can't style or fix it.
export default function BrandPicker({
  names,
  value,
  onChange,
}: {
  names: string[];
  value: string;
  onChange: (name: string) => void;
}) {
  const [query, setQuery] = useState(value);
  // Once a brand is picked the box holds its name; show every brand
  // again then, so another can be picked without clearing the box.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (value && query === value)) return names;
    return names.filter((n) => n.toLowerCase().includes(q));
  }, [names, query, value]);

  // Keep the picked brand in sight in the list.
  const pickedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    pickedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [value, shown]);

  const pick = (name: string) => {
    setQuery(name);
    onChange(name);
  };

  return (
    <div>
      <input
        type="text"
        className="input"
        placeholder={names.length ? 'Type or pick the brand…' : 'Loading…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Typing a brand's full name picks it; anything else clears the
          // pick until one is chosen from the list.
          const typed = e.target.value.trim().toLowerCase();
          onChange(names.find((n) => n.toLowerCase() === typed) || '');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && shown.length === 1) {
            e.preventDefault();
            pick(shown[0]);
          }
        }}
      />
      <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-700 bg-pos-card">
        {shown.length === 0 ? (
          <p className="px-3 py-2 text-sm text-gray-400">
            {names.length ? 'No brand matches' : 'Loading brands…'}
          </p>
        ) : (
          shown.map((n) => (
            <button
              key={n}
              ref={n === value ? pickedRef : undefined}
              type="button"
              className={`block w-full text-left px-3 py-2 text-sm ${
                n === value ? 'bg-primary-600 text-white' : 'text-pos-text hover:bg-pos-accent'
              }`}
              onClick={() => pick(n)}
            >
              {n}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
