import React, { useRef, useEffect, useState } from 'react';
import { Subtitle } from '../types';
import { formatTimeYT, parseTimeYT } from '../utils/srt';
import { cn } from '../utils/cn';
import { Trash2, Plus, Scissors, Combine } from 'lucide-react';

interface SubtitleListProps {
  subtitles: Subtitle[];
  selectedId: string | null;
  activeId?: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, newText: string) => void;
  onTimeChange: (id: string, type: 'start' | 'end', value: number) => void;
  onDelete: (id: string) => void;
  onAdd: (afterId: string) => void;
  onSplit: (id: string) => void;
  onMergeNext: (id: string) => void;
}

export default function SubtitleList({
  subtitles,
  selectedId,
  activeId,
  onSelect,
  onChange,
  onTimeChange,
  onDelete,
  onAdd,
  onSplit,
  onMergeNext
}: SubtitleListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // Scroll to selected item
  useEffect(() => {
    if (selectedId && listRef.current) {
      const element = document.getElementById(`subtitle-item-${selectedId}`);
      const container = listRef.current;
      if (element) {
        const targetScrollTop = element.offsetTop - (container.clientHeight / 2) + (element.clientHeight / 2);
        container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      }
    }
  }, [selectedId]);

  // Scroll to active item
  useEffect(() => {
    if (activeId && listRef.current) {
      const element = document.getElementById(`subtitle-item-${activeId}`);
      const container = listRef.current;
      if (element) {
        const targetScrollTop = element.offsetTop - (container.clientHeight / 2) + (element.clientHeight / 2);
        container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      }
    }
  }, [activeId]);

  const handleTimeBlur = (id: string, type: 'start' | 'end', value: string) => {
    const seconds = parseTimeYT(value);
    if (!isNaN(seconds)) {
      onTimeChange(id, type, seconds);
    }
  };

  return (
    <div 
      ref={listRef}
      className="flex-1 overflow-y-auto bg-zinc-900 relative"
    >
      {subtitles.length === 0 ? (
        <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
          No subtitles loaded. Upload an SRT file.
        </div>
      ) : (
        subtitles.map((sub) => {
          const isSelected = sub.id === selectedId;
          const isActive = sub.id === activeId;
          
          return (
            <div
              key={sub.id}
              id={`subtitle-item-${sub.id}`}
              onClick={() => onSelect(sub.id)}
              className={cn(
                "group relative flex flex-col gap-2 p-3 border-b border-zinc-800 transition-colors cursor-text",
                isSelected 
                  ? "bg-zinc-800/80" 
                  : "hover:bg-zinc-800/40",
                isActive && !isSelected ? "bg-zinc-800/40 border-l-2 border-l-indigo-500" : ""
              )}
            >
              {/* Text Area */}
              <div className="flex-1 flex flex-col">
                <textarea
                  id={`subtitle-input-${sub.id}`}
                  value={sub.text}
                  onChange={(e) => onChange(sub.id, e.target.value)}
                  onFocus={() => onSelect(sub.id)}
                  className="w-full bg-transparent border border-transparent hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-900 rounded p-2 resize-none text-sm text-zinc-200 placeholder-zinc-500 transition-colors"
                  rows={2}
                  placeholder="Enter subtitle text..."
                />
              </div>

              {/* Time Inputs & Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <input
                    key={`start-${sub.startSeconds}`}
                    type="text"
                    className="w-20 border border-transparent hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-900 rounded px-1 py-1 text-xs text-center font-mono text-zinc-400 bg-transparent transition-colors"
                    defaultValue={formatTimeYT(sub.startSeconds)}
                    onBlur={(e) => handleTimeBlur(sub.id, 'start', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                  <span className="text-zinc-600 text-xs">-</span>
                  <input
                    key={`end-${sub.endSeconds}`}
                    type="text"
                    className="w-20 border border-transparent hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-900 rounded px-1 py-1 text-xs text-center font-mono text-zinc-400 bg-transparent transition-colors"
                    defaultValue={formatTimeYT(sub.endSeconds)}
                    onBlur={(e) => handleTimeBlur(sub.id, 'end', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                </div>
                
                {/* Actions */}
                <div className={cn(
                  "flex items-center gap-1 transition-opacity",
                  isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onSplit(sub.id); }}
                    className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-indigo-400 transition-colors"
                    title="Split subtitle in half"
                  >
                    <Scissors size={14} />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onMergeNext(sub.id); }}
                    className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-indigo-400 transition-colors"
                    title="Merge with next subtitle"
                  >
                    <Combine size={14} />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onAdd(sub.id); }}
                    className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                    title="Add subtitle after this"
                  >
                    <Plus size={14} />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDelete(sub.id); }}
                    className="p-1.5 hover:bg-red-500/10 rounded text-zinc-400 hover:text-red-400 transition-colors"
                    title="Delete subtitle"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
