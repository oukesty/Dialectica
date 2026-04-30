"use client";

import { useEffect, useRef } from "react";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Smileys",
    emojis: [
      "\u{1F600}", "\u{1F603}", "\u{1F604}", "\u{1F601}", "\u{1F606}", "\u{1F605}",
      "\u{1F602}", "\u{1F923}", "\u{1F60A}", "\u{1F607}", "\u{1F642}", "\u{1F643}",
      "\u{1F609}", "\u{1F60C}", "\u{1F60D}", "\u{1F970}", "\u{1F618}", "\u{1F617}",
      "\u{1F619}", "\u{1F61A}", "\u{1F60B}", "\u{1F61C}", "\u{1F61D}", "\u{1F61B}",
      "\u{1F911}", "\u{1F917}", "\u{1F914}", "\u{1F910}", "\u{1F928}", "\u{1F610}",
      "\u{1F611}", "\u{1F636}", "\u{1F644}", "\u{1F62C}", "\u{1F925}", "\u{1F60F}",
      "\u{1F612}", "\u{1F61E}", "\u{1F614}", "\u{1F61F}", "\u{1F615}", "\u{1F641}",
      "\u{1F623}", "\u{1F616}", "\u{1F62B}", "\u{1F629}", "\u{1F622}", "\u{1F62D}",
      "\u{1F624}", "\u{1F620}", "\u{1F621}", "\u{1F92C}", "\u{1F633}", "\u{1F631}",
      "\u{1F628}", "\u{1F630}", "\u{1F975}", "\u{1F976}", "\u{1F974}", "\u{1F634}",
    ],
  },
  {
    label: "Gestures",
    emojis: [
      "\u{1F44D}", "\u{1F44E}", "\u{1F44A}", "\u{270A}", "\u{1F91B}", "\u{1F91C}",
      "\u{1F44F}", "\u{1F64C}", "\u{1F450}", "\u{1F64F}", "\u{1F91D}", "\u{270C}\uFE0F",
      "\u{1F91E}", "\u{1F91F}", "\u{1F918}", "\u{1F44C}", "\u{1F448}", "\u{1F449}",
      "\u{1F446}", "\u{1F447}", "\u{261D}\uFE0F", "\u{270B}", "\u{1F44B}", "\u{1F4AA}",
    ],
  },
  {
    label: "Objects",
    emojis: [
      "\u{2764}\uFE0F", "\u{1F4AF}", "\u{2B50}", "\u{1F525}", "\u{1F389}", "\u{1F388}",
      "\u{1F381}", "\u{1F3C6}", "\u{1F4A1}", "\u{1F4DD}", "\u{1F4DA}", "\u{1F4CE}",
      "\u{1F4CB}", "\u{1F512}", "\u{1F511}", "\u{1F4E7}", "\u{1F4E2}", "\u{1F514}",
      "\u{2705}", "\u{274C}", "\u{2757}", "\u{2753}", "\u{1F50D}", "\u{1F4F1}",
    ],
  },
  {
    label: "Nature",
    emojis: [
      "\u{2600}\uFE0F", "\u{1F319}", "\u{26C5}", "\u{1F308}", "\u{1F333}", "\u{1F331}",
      "\u{1F340}", "\u{1F338}", "\u{1F337}", "\u{1F339}", "\u{1F436}", "\u{1F431}",
      "\u{1F981}", "\u{1F427}", "\u{1F98B}", "\u{1F41D}", "\u{1F42C}", "\u{1F40B}",
    ],
  },
  {
    label: "Food",
    emojis: [
      "\u{2615}", "\u{1F375}", "\u{1F37A}", "\u{1F377}", "\u{1F355}", "\u{1F354}",
      "\u{1F363}", "\u{1F370}", "\u{1F382}", "\u{1F36B}", "\u{1F34E}", "\u{1F353}",
    ],
  },
];

export function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 z-50 mb-2 w-[20rem] rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-3 shadow-lg"
    >
      <div className="soft-scrollbar max-h-[16rem] space-y-3 overflow-y-auto">
        {EMOJI_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted)]">{group.label}</p>
            <div className="flex flex-wrap gap-0.5">
              {group.emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-[color:var(--surface-muted)]"
                  onClick={() => onSelect(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
