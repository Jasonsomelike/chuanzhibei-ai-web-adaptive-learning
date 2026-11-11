"use client";

import { useEffect, useState } from "react";

export function DocumentNav({
  items,
  label,
}: {
  items: readonly { id: string; title: string }[];
  label: string;
}) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = items.find((item) => visible.has(item.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-90px 0px -55% 0px", threshold: 0 },
    );
    for (const item of items) {
      const section = document.getElementById(item.id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [items]);
  return (
    <nav className="document-nav" aria-label={label}>
      <h2>目录</h2>
      {items.map((item) => (
        <a
          key={item.id}
          href={"#" + item.id}
          aria-current={active === item.id ? "location" : undefined}
          onClick={() => setActive(item.id)}
        >
          {item.title}
        </a>
      ))}
    </nav>
  );
}
