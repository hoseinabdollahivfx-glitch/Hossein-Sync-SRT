import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { Subtitle } from '../types';
import { Play, Pause, ZoomIn, ZoomOut, Type, Music, SkipBack, SkipForward } from 'lucide-react';
import { formatTimeYT } from '../utils/srt';

function findNearestSnapPoint(time: number, snapPoints: number[], threshold: number): number | null {
  let nearest = null;
  let minDiff = threshold;
  for (const point of snapPoints) {
    const diff = Math.abs(point - time);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = point;
    }
  }
  return nearest;
}

interface WaveformProps {
  mediaElement: HTMLMediaElement;
  audioUrl: string;
  subtitles: Subtitle[];
  onSubtitlesChange: (newSubtitles: Subtitle[]) => void;
  onSubtitleSelect: (id: string) => void;
  selectedSubtitleId: string | null;
  onTimeUpdate?: (time: number) => void;
}

export default function Waveform({
  mediaElement,
  audioUrl,
  subtitles,
  onSubtitlesChange,
  onSubtitleSelect,
  selectedSubtitleId,
  onTimeUpdate
}: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<RegionsPlugin | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const isInitializingRef = useRef(false);
  const isSyncingRef = useRef(false);
  const stopPlayRef = useRef<(() => void) | null>(null);
  const subtitlesRef = useRef(subtitles);
  const selectedSubtitleIdRef = useRef(selectedSubtitleId);
  const snapPointsRef = useRef<number[]>([]);
  const virtualRegionRef = useRef<{ id: string, start: number, end: number, lastActualStart: number, lastActualEnd: number } | null>(null);

  useEffect(() => {
    subtitlesRef.current = subtitles;
  }, [subtitles]);

  useEffect(() => {
    selectedSubtitleIdRef.current = selectedSubtitleId;
  }, [selectedSubtitleId]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !timelineRef.current) return;

    setIsReady(false);

    const regions = RegionsPlugin.create();
    regionsPluginRef.current = regions;

    const timeline = TimelinePlugin.create({
      container: timelineRef.current,
      height: 24,
      timeInterval: 1,
      primaryLabelInterval: 5,
      style: {
        fontSize: '12px',
        color: '#9ca3af', // text-zinc-400
      },
    });

    let ws: WaveSurfer;
    try {
      ws = WaveSurfer.create({
        container: containerRef.current,
        media: mediaElement,
        waveColor: '#3f3f46', // zinc-700
        progressColor: '#4f46e5', // indigo-600
        cursorColor: '#3b82f6', // blue-500
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 120,
        normalize: true,
        plugins: [regions, timeline],
      });
    } catch (err) {
      console.error("Failed to initialize WaveSurfer:", err);
      setIsReady(false);
      return;
    }

    wavesurferRef.current = ws;

    ws.on('ready', () => {
      setIsReady(true);
      const dur = ws.getDuration();
      setDuration(dur);
      try {
        ws.zoom(zoom);
      } catch (err) {
        console.warn("Could not apply zoom on ready:", err);
      }

      // Calculate snap points (onsets and offsets)
      try {
        const peaks = ws.exportPeaks({ maxLength: Math.floor(dur * 100) })[0];
        if (peaks) {
          let maxPeak = 0;
          for (let i = 0; i < peaks.length; i++) {
            if (Math.abs(peaks[i]) > maxPeak) maxPeak = Math.abs(peaks[i]);
          }

          const points: number[] = [];
          const threshold = maxPeak * 0.05; // Silence threshold (5% of max)
          const activeThreshold = maxPeak * 0.15; // Speech threshold (15% of max)
          let isSilent = true;

          for (let i = 0; i < peaks.length; i++) {
            const amplitude = Math.abs(peaks[i]);
            if (isSilent && amplitude > activeThreshold) {
              points.push((i / peaks.length) * dur);
              isSilent = false;
            } else if (!isSilent && amplitude < threshold) {
              points.push((i / peaks.length) * dur);
              isSilent = true;
            }
          }
          snapPointsRef.current = points;
        }
      } catch (err) {
        console.warn("Could not export peaks for snapping:", err);
      }
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));
    
    ws.on('timeupdate', (time) => {
      setCurrentTime(time);
      onTimeUpdate?.(time);
      // Auto-select subtitle based on current time
      const activeSub = subtitlesRef.current.find(sub => time >= sub.startSeconds && time <= sub.endSeconds);
      if (activeSub && activeSub.id !== selectedSubtitleIdRef.current) {
        onSubtitleSelect(activeSub.id);
      }
    });

    ws.on('click', () => {
      ws.playPause();
    });
    
    ws.on('error', (err) => {
      // Ignore abort errors which are normal during re-loads or unmounts
      if (err && err.message && err.message.includes('aborted')) {
        return;
      }
      console.error('WaveSurfer error:', err);
    });

    // Handle Region Events
    regions.on('region-update', (region) => {
      if (isSyncingRef.current) return;
      
      const subs = subtitlesRef.current;
      const currentIndex = subs.findIndex(s => s.id === region.id);
      if (currentIndex === -1) return;

      const prevSub = currentIndex > 0 ? subs[currentIndex - 1] : null;
      const nextSub = currentIndex < subs.length - 1 ? subs[currentIndex + 1] : null;
      const originalSub = subs[currentIndex];

      let newStart = region.start;
      let newEnd = region.end;
      const duration = region.end - region.start;

      const startChanged = Math.abs(newStart - originalSub.startSeconds) > 0.001;
      const endChanged = Math.abs(newEnd - originalSub.endSeconds) > 0.001;

      // Snapping logic
      let virtual = virtualRegionRef.current;
      if (!virtual || virtual.id !== region.id) {
        virtual = {
          id: region.id,
          start: originalSub.startSeconds,
          end: originalSub.endSeconds,
          lastActualStart: originalSub.startSeconds,
          lastActualEnd: originalSub.endSeconds
        };
      }

      const deltaStart = region.start - virtual.lastActualStart;
      const deltaEnd = region.end - virtual.lastActualEnd;

      virtual.start += deltaStart;
      virtual.end += deltaEnd;

      let snappedStart = virtual.start;
      let snappedEnd = virtual.end;
      let snapped = false;

      const snapThreshold = 0.15; // 150ms snap threshold

      if (startChanged && !endChanged) {
        // Dragging left handle
        const nearest = findNearestSnapPoint(virtual.start, snapPointsRef.current, snapThreshold);
        if (nearest !== null) {
          snappedStart = nearest;
          snapped = true;
        }
      } else if (endChanged && !startChanged) {
        // Dragging right handle
        const nearest = findNearestSnapPoint(virtual.end, snapPointsRef.current, snapThreshold);
        if (nearest !== null) {
          snappedEnd = nearest;
          snapped = true;
        }
      } else if (startChanged && endChanged) {
        // Dragging the whole region
        const nearestStart = findNearestSnapPoint(virtual.start, snapPointsRef.current, snapThreshold);
        if (nearestStart !== null) {
          snappedStart = nearestStart;
          snappedEnd = snappedStart + duration;
          snapped = true;
        } else {
          const nearestEnd = findNearestSnapPoint(virtual.end, snapPointsRef.current, snapThreshold);
          if (nearestEnd !== null) {
            snappedEnd = nearestEnd;
            snappedStart = snappedEnd - duration;
            snapped = true;
          }
        }
      }

      newStart = snappedStart;
      newEnd = snappedEnd;

      // Determine if they were touching (gap < 0.05s)
      const touchingPrev = prevSub && Math.abs(originalSub.startSeconds - prevSub.endSeconds) < 0.05;
      const touchingNext = nextSub && Math.abs(originalSub.endSeconds - nextSub.startSeconds) < 0.05;

      const minAllowedStart = prevSub ? (touchingPrev ? prevSub.startSeconds + 0.1 : prevSub.endSeconds) : 0;
      const maxAllowedEnd = nextSub ? (touchingNext ? nextSub.endSeconds - 0.1 : nextSub.startSeconds) : wavesurferRef.current?.getDuration() || Infinity;

      let changed = false;
      if (newStart < minAllowedStart) {
        newStart = minAllowedStart;
        if (!startChanged || endChanged) newEnd = newStart + duration;
        changed = true;
      }
      if (newEnd > maxAllowedEnd) {
        newEnd = maxAllowedEnd;
        if (!endChanged || startChanged) newStart = newEnd - duration;
        changed = true;
      }
      if (newEnd - newStart < 0.1) {
        if (startChanged && !endChanged) newStart = newEnd - 0.1;
        else newEnd = newStart + 0.1;
        changed = true;
      }

      isSyncingRef.current = true;
      
      if (changed || snapped || Math.abs(newStart - region.start) > 0.001 || Math.abs(newEnd - region.end) > 0.001) {
        region.setOptions({ start: newStart, end: newEnd });
      }

      virtual.lastActualStart = region.start;
      virtual.lastActualEnd = region.end;
      virtualRegionRef.current = virtual;

      const allRegions = regionsPluginRef.current?.getRegions() || [];
      
      if (startChanged && touchingPrev && prevSub) {
        const prevRegion = allRegions.find(r => r.id === prevSub.id);
        if (prevRegion) prevRegion.setOptions({ end: newStart });
      }
      
      if (endChanged && touchingNext && nextSub) {
        const nextRegion = allRegions.find(r => r.id === nextSub.id);
        if (nextRegion) nextRegion.setOptions({ start: newEnd });
      }

      isSyncingRef.current = false;
    });

    regions.on('region-updated', (region) => {
      if (isInitializingRef.current) return;
      
      virtualRegionRef.current = null; // Reset virtual region on drag end

      const allRegions = regionsPluginRef.current?.getRegions() || [];
      const newSubtitles = subtitlesRef.current.map(sub => {
        const r = allRegions.find(reg => reg.id === sub.id);
        if (r) {
          return { ...sub, startSeconds: r.start, endSeconds: r.end };
        }
        return sub;
      });
      
      onSubtitlesChange(newSubtitles);
    });

    regions.on('region-clicked', (region, e) => {
      e.stopPropagation();
      onSubtitleSelect(region.id);
      region.play();
    });

    return () => {
      ws.destroy();
    };
  }, [mediaElement, audioUrl]); // Re-init if mediaElement or audioUrl changes

  // Sync Subtitles to Regions
  useEffect(() => {
    if (!regionsPluginRef.current || !wavesurferRef.current || !isReady) return;
    
    const regions = regionsPluginRef.current;
    isInitializingRef.current = true;

    // We only want to add/update regions, not recreate them constantly to avoid losing interaction state
    const existingRegions = regions.getRegions();
    
    subtitles.forEach(sub => {
      const existing = existingRegions.find(r => r.id === sub.id);
      const isSelected = sub.id === selectedSubtitleId;
      const color = isSelected ? 'rgba(249, 115, 22, 0.9)' : 'rgba(249, 115, 22, 0.6)'; // Orange

      const contentStr = sub.text.replace(/\n/g, ' ');
      let contentEl = existing?.content as HTMLElement | undefined;
      
      if (!contentEl || contentEl.getAttribute('data-text') !== contentStr) {
        contentEl = document.createElement('div');
        contentEl.setAttribute('data-text', contentStr);
        contentEl.className = 'waveform-region-content';
        contentEl.style.cssText = 'width: 100%; height: 100%; pointer-events: none; display: flex; align-items: center; justify-content: center; padding: 0 8px; box-sizing: border-box; position: relative;';
        
        const textSpan = document.createElement('span');
        textSpan.textContent = contentStr;
        textSpan.dir = 'rtl';
        textSpan.style.cssText = 'font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.95); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-shadow: 0 1px 2px rgba(0,0,0,0.8); font-family: system-ui, sans-serif;';
        
        const leftHandle = document.createElement('div');
        leftHandle.className = 'waveform-region-handle left-handle';
        leftHandle.style.cssText = 'position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: rgba(255,255,255,0.3); border-radius: 4px 0 0 4px; border-right: 1px solid rgba(0,0,0,0.2);';
        
        const rightHandle = document.createElement('div');
        rightHandle.className = 'waveform-region-handle right-handle';
        rightHandle.style.cssText = 'position: absolute; right: 0; top: 0; bottom: 0; width: 6px; background: rgba(255,255,255,0.3); border-radius: 0 4px 4px 0; border-left: 1px solid rgba(0,0,0,0.2);';

        contentEl.appendChild(leftHandle);
        contentEl.appendChild(textSpan);
        contentEl.appendChild(rightHandle);
      }

      let region = existing;
      if (existing) {
        // Only update if times are significantly different to avoid feedback loops
        if (Math.abs(existing.start - sub.startSeconds) > 0.01 || Math.abs(existing.end - sub.endSeconds) > 0.01) {
          existing.setOptions({ start: sub.startSeconds, end: sub.endSeconds, color, content: contentEl });
        } else if (existing.color !== color || existing.content !== contentEl) {
          existing.setOptions({ color, content: contentEl });
        }
      } else {
        region = regions.addRegion({
          id: sub.id,
          start: sub.startSeconds,
          end: sub.endSeconds,
          color: color,
          content: contentEl,
          drag: true,
          resize: true,
        });
      }

      // Style the region element directly to make it look like a track
      if (region && (region as any).element) {
        const el = (region as any).element as HTMLElement;
        el.classList.add('waveform-region');
        if (isSelected) {
          el.classList.add('selected');
        } else {
          el.classList.remove('selected');
        }
        el.style.height = '45%';
        el.style.top = '0';
        el.style.border = isSelected ? '2px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.3)';
        el.style.borderRadius = '4px';
        el.style.boxSizing = 'border-box';
        el.style.marginTop = '4px'; // small gap from top
        el.style.transition = 'background-color 0.2s ease, border-color 0.2s ease';
      }
    });

    // Remove regions that no longer exist in subtitles
    existingRegions.forEach(r => {
      if (!subtitles.find(s => s.id === r.id)) {
        r.remove();
      }
    });

    isInitializingRef.current = false;
  }, [subtitles, selectedSubtitleId, isReady]);

  // Handle Zoom
  useEffect(() => {
    if (wavesurferRef.current && isReady) {
      try {
        wavesurferRef.current.zoom(zoom);
      } catch (err) {
        console.warn("Could not apply zoom:", err);
      }
    }
  }, [zoom, isReady]);

  const togglePlay = () => {
    if (mediaElement && isReady) {
      if (stopPlayRef.current) {
        mediaElement.removeEventListener('timeupdate', stopPlayRef.current);
        stopPlayRef.current = null;
      }
      if (mediaElement.paused) {
        mediaElement.play().catch(console.error);
      } else {
        mediaElement.pause();
      }
    }
  };

  const playSubtitleBlock = (id: string) => {
    const sub = subtitles.find(s => s.id === id);
    if (!sub || !mediaElement || !isReady) return;
    
    if (stopPlayRef.current) {
      mediaElement.removeEventListener('timeupdate', stopPlayRef.current);
      stopPlayRef.current = null;
    }
    
    mediaElement.currentTime = sub.startSeconds;
    mediaElement.play().catch(console.error);
    
    const handleTimeUpdate = () => {
      if (mediaElement.currentTime >= sub.endSeconds) {
        mediaElement.pause();
        mediaElement.removeEventListener('timeupdate', handleTimeUpdate);
        stopPlayRef.current = null;
      }
    };
    
    stopPlayRef.current = handleTimeUpdate;
    mediaElement.addEventListener('timeupdate', handleTimeUpdate);
  };

  const handleNextSubtitle = () => {
    if (!selectedSubtitleId) {
      if (subtitles.length > 0) {
        onSubtitleSelect(subtitles[0].id);
        playSubtitleBlock(subtitles[0].id);
      }
      return;
    }
    const index = subtitles.findIndex(s => s.id === selectedSubtitleId);
    if (index !== -1 && index < subtitles.length - 1) {
      const nextId = subtitles[index + 1].id;
      onSubtitleSelect(nextId);
      playSubtitleBlock(nextId);
    }
  };

  const handlePrevSubtitle = () => {
    if (!selectedSubtitleId) {
      if (subtitles.length > 0) {
        onSubtitleSelect(subtitles[0].id);
        playSubtitleBlock(subtitles[0].id);
      }
      return;
    }
    const index = subtitles.findIndex(s => s.id === selectedSubtitleId);
    if (index > 0) {
      const prevId = subtitles[index - 1].id;
      onSubtitleSelect(prevId);
      playSubtitleBlock(prevId);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Controls */}
      <div className="flex items-center justify-between p-2 border-b border-zinc-800 bg-zinc-900 relative">
        <div className="flex items-center gap-2 w-1/3">
          {/* Left side empty or add other controls if needed */}
        </div>
        
        <div className="flex items-center justify-center gap-3 w-1/3">
          <button
            onClick={handlePrevSubtitle}
            disabled={!isReady || subtitles.length === 0}
            className={`flex items-center justify-center w-8 h-8 rounded-full text-white transition-colors ${
              isReady && subtitles.length > 0 ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-zinc-900 cursor-not-allowed text-zinc-600'
            }`}
            title="Previous Subtitle"
          >
            <SkipBack size={14} />
          </button>
          
          <button
            onClick={togglePlay}
            disabled={!isReady}
            className={`flex items-center justify-center w-10 h-10 rounded-full text-white transition-colors ${
              isReady ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-zinc-800 cursor-not-allowed text-zinc-600'
            }`}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          
          <button
            onClick={handleNextSubtitle}
            disabled={!isReady || subtitles.length === 0}
            className={`flex items-center justify-center w-8 h-8 rounded-full text-white transition-colors ${
              isReady && subtitles.length > 0 ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-zinc-900 cursor-not-allowed text-zinc-600'
            }`}
            title="Next Subtitle"
          >
            <SkipForward size={14} />
          </button>
        </div>
        
        <div className="flex items-center justify-end gap-2 w-1/3">
          <button 
            onClick={() => setZoom(Math.max(10, zoom - 10))}
            disabled={!isReady || zoom <= 10}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>
          <input
            type="range"
            min="10"
            max="200"
            value={zoom}
            disabled={!isReady}
            onChange={(e) => setZoom(Number(e.target.value))}
            className={`w-24 accent-indigo-500 ${!isReady ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
          <button 
            onClick={() => setZoom(Math.min(200, zoom + 10))}
            disabled={!isReady || zoom >= 200}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            title="Zoom In"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      {/* Waveform Container */}
      <div className="relative flex-1 w-full overflow-hidden bg-zinc-900 flex">
        {/* Track Headers */}
        <div className="w-24 md:w-32 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col z-20">
          <div className="h-[25px] border-b border-zinc-800 bg-zinc-900 shrink-0"></div>
          <div className="flex-1 flex flex-col relative">
             <div className="absolute top-0 left-0 right-0 h-[50%] border-b border-zinc-800/50 flex items-center px-3 text-xs font-medium text-zinc-400 bg-zinc-900">
               <Type size={14} className="mr-2 text-orange-500" /> <span className="hidden md:inline">Subtitles</span><span className="md:hidden">V1</span>
             </div>
             <div className="absolute bottom-0 left-0 right-0 h-[50%] flex items-center px-3 text-xs font-medium text-zinc-400 bg-zinc-900">
               <Music size={14} className="mr-2 text-indigo-500" /> <span className="hidden md:inline">Audio 1</span><span className="md:hidden">A1</span>
             </div>
          </div>
        </div>

        {/* Waveform Area */}
        <div className="relative flex-1 flex flex-col overflow-hidden">
          {!isReady && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-zinc-300 font-medium">
                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                Loading media...
              </div>
            </div>
          )}
          <div ref={timelineRef} className="w-full border-b border-zinc-800 bg-zinc-900 shrink-0" />
          <div ref={containerRef} className="w-full flex-1 relative" />
        </div>
      </div>

      {/* Time Display */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900 border-t border-zinc-800 text-xs font-mono text-zinc-500 shrink-0">
        <span>{formatTimeYT(currentTime)}</span>
        <span>{formatTimeYT(duration)}</span>
      </div>
    </div>
  );
}
