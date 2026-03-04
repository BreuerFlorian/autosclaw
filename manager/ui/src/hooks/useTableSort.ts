import { useState, useMemo, useCallback } from "react";

export type SortDir = "asc" | "desc";

export type SortState<K extends string> = {
  key: K;
  dir: SortDir;
};

export function useTableSort<K extends string>(defaultKey: K, defaultDir: SortDir = "asc") {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, dir: defaultDir });

  const toggle = useCallback((key: K) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }, []);

  return { sort, toggle };
}

export function sortItems<T, K extends string>(
  items: T[],
  sort: SortState<K>,
  getters: Record<K, (item: T) => string | number>,
): T[] {
  const getter = getters[sort.key];
  if (!getter) return items;
  const sorted = [...items].sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb));
  });
  if (sort.dir === "desc") sorted.reverse();
  return sorted;
}

export function sortIndicator<K extends string>(sort: SortState<K>, key: K): string {
  if (sort.key !== key) return "";
  return sort.dir === "asc" ? " \u25B2" : " \u25BC";
}
