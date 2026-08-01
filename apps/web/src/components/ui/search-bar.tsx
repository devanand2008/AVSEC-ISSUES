"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  id?: string;
}

export function SearchBar({ value, onChange, placeholder = "Search…", debounceMs = 300, id }: SearchBarProps) {
  const [draft, setDraft] = useState({ sourceValue: value, value });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const local = draft.sourceValue === value ? draft.value : value;

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const handleChange = useCallback(
    (val: string) => {
      setDraft({ sourceValue: value, value: val });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onChange(val), debounceMs);
    },
    [value, onChange, debounceMs],
  );

  const clear = useCallback(() => {
    setDraft({ sourceValue: value, value: "" });
    clearTimeout(timer.current);
    onChange("");
  }, [value, onChange]);

  return (
    <div className="avs-search-bar">
      <Search className="search-icon" aria-hidden />
      <input
        id={id ?? "avs-search"}
        className="avs-input"
        type="search"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={placeholder}
      />
      {local && (
        <button className="clear-btn" onClick={clear} aria-label="Clear search" type="button">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
