import { useMemo, useState } from "react";

import { usSchools } from "@/data/us-schools";

type SchoolFieldProps = {
  value: string;
  onChange: (value: string) => void;
  className: string;
  autoFocus?: boolean;
  placeholder?: string;
};

/**
 * School input with a filtered dropdown of U.S. colleges and universities.
 * Free text is still allowed so unlisted schools can be typed in.
 */
export function SchoolField({
  value,
  onChange,
  className,
  autoFocus,
  placeholder = "University of Pittsburgh",
}: SchoolFieldProps) {
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (query.length < 2) return [];
    const startsWith: string[] = [];
    const contains: string[] = [];
    for (const school of usSchools) {
      const lower = school.toLowerCase();
      if (lower.startsWith(query)) startsWith.push(school);
      else if (lower.includes(query)) contains.push(school);
      if (startsWith.length >= 8) break;
    }
    return [...startsWith, ...contains].slice(0, 8);
  }, [value]);

  const showList = open && matches.length > 0 && matches[0] !== value.trim();

  return (
    <div className="relative">
      <input
        autoFocus={autoFocus}
        className={className}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay closing so a click on a suggestion still registers.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        maxLength={160}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
      />
      {showList ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-card py-1 shadow-lg">
          {matches.map((school) => (
            <li key={school}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-foreground/80 hover:bg-primary/10 hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(school);
                  setOpen(false);
                }}
              >
                {school}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
