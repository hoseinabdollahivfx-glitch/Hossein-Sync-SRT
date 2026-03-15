import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, FileAudio, FileText, Settings, Layout, Video } from 'lucide-react';
import Waveform from './components/Waveform';
import SubtitleList from './components/SubtitleList';
import { Subtitle } from './types';
import { parseSrt, exportSrt, formatTimeYT } from './utils/srt';

export default function App() {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'audio' | 'video' | null>(null);
  const [audioName, setAudioName] = useState<string>('');
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const processMediaFile = (file: File) => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioName(file.name);
    setMediaType(file.type.startsWith('video/') ? 'video' : 'audio');
  };

  const processSrtFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseSrt(text);
      setSubtitles(parsed);
      if (parsed.length > 0) {
        setSelectedSubtitleId(parsed[0].id);
      }
    };
    reader.readAsText(file);
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processMediaFile(file);
  };

  const handleSrtUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processSrtFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    
    const files = Array.from(e.dataTransfer.files) as File[];
    
    const audioFile = files.find(f => f.type.startsWith('audio/') || f.type.startsWith('video/'));
    const srtFile = files.find(f => f.name.endsWith('.srt'));
    
    if (audioFile) processMediaFile(audioFile);
    if (srtFile) processSrtFile(srtFile);
  };

  const handleExport = () => {
    if (subtitles.length === 0) return;
    const srtContent = exportSrt(subtitles);
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'synced_subtitles.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSubtitlesChange = useCallback((newSubtitles: Subtitle[]) => {
    setSubtitles(newSubtitles);
  }, []);

  const handleSubtitleManualTimeChange = useCallback((id: string, type: 'start' | 'end', value: number) => {
    setSubtitles(prev => {
      const index = prev.findIndex(s => s.id === id);
      if (index === -1) return prev;
      
      const newSubs = [...prev];
      const sub = newSubs[index];
      
      let newStart = type === 'start' ? value : sub.startSeconds;
      let newEnd = type === 'end' ? value : sub.endSeconds;
      
      // Ensure start is before end
      if (newStart >= newEnd) {
        if (type === 'start') newEnd = newStart + 0.1;
        else newStart = Math.max(0, newEnd - 0.1);
      }
      
      // Prevent overlapping with adjacent subtitles' boundaries
      if (type === 'start' && index > 0) {
        const prevSub = newSubs[index - 1];
        if (newStart <= prevSub.startSeconds) {
          newStart = prevSub.startSeconds + 0.1;
        }
      }
      if (type === 'end' && index < newSubs.length - 1) {
        const nextSub = newSubs[index + 1];
        if (newEnd >= nextSub.endSeconds) {
          newEnd = nextSub.endSeconds - 0.1;
        }
      }
      
      newSubs[index] = { ...sub, startSeconds: newStart, endSeconds: newEnd };
      
      // Ripple edit to adjacent subtitles
      if (type === 'start' && index > 0) {
        newSubs[index - 1] = { ...newSubs[index - 1], endSeconds: newStart };
      }
      if (type === 'end' && index < newSubs.length - 1) {
        newSubs[index + 1] = { ...newSubs[index + 1], startSeconds: newEnd };
      }
      
      return newSubs;
    });
  }, []);

  const handleSubtitleTextChange = useCallback((id: string, newText: string) => {
    setSubtitles(prev => prev.map(sub => 
      sub.id === id ? { ...sub, text: newText } : sub
    ));
  }, []);

  const handleSubtitleDelete = useCallback((id: string) => {
    setSubtitles(prev => prev.filter(sub => sub.id !== id));
    if (selectedSubtitleId === id) {
      setSelectedSubtitleId(null);
    }
  }, [selectedSubtitleId]);

  const handleSubtitleAdd = useCallback((afterId: string) => {
    setSubtitles(prev => {
      const index = prev.findIndex(s => s.id === afterId);
      if (index === -1) return prev;
      
      const currentSub = prev[index];
      const nextSub = index < prev.length - 1 ? prev[index + 1] : null;
      
      const newId = Math.random().toString(36).substr(2, 9);
      
      let start = currentSub.endSeconds;
      let end = start + 2.0;
      
      if (nextSub && end > nextSub.startSeconds) {
        end = Math.max(start + 0.5, nextSub.startSeconds);
      }
      
      // If there's literally no space between current and next, we have to squeeze it
      if (nextSub && start >= nextSub.startSeconds) {
        start = currentSub.endSeconds;
        end = start + 0.1;
      }
      
      const newSub: Subtitle = {
        id: newId,
        startSeconds: start,
        endSeconds: end,
        text: 'New subtitle'
      };
      
      const newSubs = [...prev];
      newSubs.splice(index + 1, 0, newSub);
      return newSubs;
    });
  }, []);

  const handleSubtitleSplit = useCallback((id: string) => {
    setSubtitles(prev => {
      const index = prev.findIndex(s => s.id === id);
      if (index === -1) return prev;
      
      const currentSub = prev[index];
      const duration = currentSub.endSeconds - currentSub.startSeconds;
      
      // Don't split if it's too short
      if (duration < 0.2) return prev;
      
      const midPoint = currentSub.startSeconds + (duration / 2);
      
      // Try to split text at the nearest punctuation or space to the middle
      const text = currentSub.text;
      const midLen = Math.floor(text.length / 2);
      
      let bestSplitIndex = midLen;
      let bestScore = -1;
      
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        let weight = 0;
        
        if (['.', '!', '?', '؟'].includes(char)) weight = 3;
        else if ([',', '،', ';', '؛', ':'].includes(char)) weight = 2;
        else if (char === ' ' || char === '\n') weight = 1;
        
        if (weight > 0) {
          // Distance from middle (0 to 1, where 0 is at the ends, 1 is exactly middle)
          const distFromMid = 1 - (Math.abs(i - midLen) / (midLen || 1));
          
          // Only consider points that are somewhat near the middle, unless they are strong punctuation
          if (distFromMid > 0.2 || weight > 1) {
            const score = weight * 10 + distFromMid * 5;
            if (score > bestScore) {
              bestScore = score;
              bestSplitIndex = i;
            }
          }
        }
      }
      
      let splitIndex1 = bestSplitIndex;
      let splitIndex2 = bestSplitIndex;
      
      // If we split at a punctuation, include it in the first part
      if (['.', '!', '?', '؟', ',', '،', ';', '؛', ':'].includes(text[bestSplitIndex])) {
        splitIndex1 = bestSplitIndex + 1;
        splitIndex2 = bestSplitIndex + 1;
      }
      
      const text1 = text.substring(0, splitIndex1).trim();
      const text2 = text.substring(splitIndex2).trim();
      
      const newId = Math.random().toString(36).substr(2, 9);
      
      const sub1: Subtitle = {
        ...currentSub,
        endSeconds: midPoint,
        text: text1 || '...'
      };
      
      const sub2: Subtitle = {
        id: newId,
        startSeconds: midPoint,
        endSeconds: currentSub.endSeconds,
        text: text2 || '...'
      };
      
      const newSubs = [...prev];
      newSubs.splice(index, 1, sub1, sub2);
      return newSubs;
    });
  }, []);

  const handleSubtitleMergeNext = useCallback((id: string) => {
    setSubtitles(prev => {
      const index = prev.findIndex(s => s.id === id);
      if (index === -1 || index === prev.length - 1) return prev;
      
      const currentSub = prev[index];
      const nextSub = prev[index + 1];
      
      const mergedSub: Subtitle = {
        ...currentSub,
        endSeconds: nextSub.endSeconds,
        text: `${currentSub.text.trim()} ${nextSub.text.trim()}`
      };
      
      const newSubs = [...prev];
      newSubs.splice(index, 2, mergedSub);
      return newSubs;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          return;
        }
        e.preventDefault();
        if (mediaEl) {
          if (mediaEl.paused) {
            mediaEl.play().catch(console.error);
          } else {
            mediaEl.pause();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mediaEl]);

  const activeSubtitle = subtitles.find(s => currentTime >= s.startSeconds && currentTime <= s.endSeconds);

  const isRTL = (text: string) => {
    const rtlChars = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
    return rtlChars.test(text);
  };

  return (
    <div 
      className="h-screen bg-zinc-950 flex flex-col font-sans overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm border-4 border-indigo-500 border-dashed m-4 rounded-2xl flex items-center justify-center pointer-events-none">
          <div className="bg-zinc-900 px-8 py-6 rounded-xl shadow-2xl flex flex-col items-center gap-4 border border-zinc-800">
            <div className="w-16 h-16 bg-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center">
              <Upload size={32} />
            </div>
            <h2 className="text-2xl font-bold text-zinc-100">Drop files here</h2>
            <p className="text-zinc-400 text-center max-w-sm">
              Drag and drop your audio/video file and SRT subtitle file to load them instantly.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-1.5 rounded text-white">
            <Layout size={18} />
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">WaveSync Studio</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            disabled={subtitles.length === 0}
            className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 text-white rounded-full hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            Publish
          </button>
        </div>
      </header>

      {/* Main Content Split */}
      <main className="flex-1 flex flex-col min-h-0">
        
        {/* Top Half: Editor and Preview */}
        <div className="flex-1 flex flex-row min-h-0 border-b border-zinc-800">
          
          {/* Left: Subtitle Editor */}
          <div className="w-[35%] flex flex-col border-r border-zinc-800 bg-zinc-900">
            <div className="p-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900 shrink-0">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => srtInputRef.current?.click()}
                  className="text-sm font-medium text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-md transition-colors flex items-center gap-2"
                >
                  <FileText size={16} />
                  {subtitles.length > 0 ? 'Replace SRT' : 'Upload SRT'}
                </button>
                <input
                  type="file"
                  accept=".srt"
                  className="hidden"
                  ref={srtInputRef}
                  onChange={handleSrtUpload}
                />
              </div>
              <span className="text-xs font-medium text-zinc-500">
                {subtitles.length} captions
              </span>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col">
              <SubtitleList
                subtitles={subtitles}
                selectedId={selectedSubtitleId}
                activeId={activeSubtitle?.id}
                onSelect={setSelectedSubtitleId}
                onChange={handleSubtitleTextChange}
                onTimeChange={handleSubtitleManualTimeChange}
                onDelete={handleSubtitleDelete}
                onAdd={handleSubtitleAdd}
                onSplit={handleSubtitleSplit}
                onMergeNext={handleSubtitleMergeNext}
              />
            </div>
          </div>

          {/* Right: Audio/Video Preview */}
          <div className="w-[65%] bg-black flex flex-col relative overflow-hidden">
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 p-8 text-center relative">
              {audioUrl ? (
                <>
                  {mediaType === 'video' ? (
                    <video 
                      ref={setMediaEl} 
                      src={audioUrl} 
                      className="absolute inset-0 w-full h-full object-contain" 
                    />
                  ) : (
                    <audio 
                      ref={setMediaEl} 
                      src={audioUrl} 
                      className="hidden" 
                    />
                  )}

                  {mediaType !== 'video' && (
                    <div className="z-10 flex flex-col items-center">
                      <FileAudio size={48} className="mb-4 opacity-20" />
                      <p className="text-lg font-medium text-zinc-300">Audio Loaded</p>
                      <p className="text-sm mt-2">{audioName}</p>
                    </div>
                  )}

                  <button
                    onClick={() => audioInputRef.current?.click()}
                    className="absolute top-4 right-4 z-20 px-3 py-1.5 bg-black/50 hover:bg-black/80 backdrop-blur text-white rounded-md text-xs font-medium transition-colors border border-white/10"
                  >
                    Change Media
                  </button>
                  
                  {/* Subtitle Overlay */}
                  {activeSubtitle && (
                    <div className="absolute inset-x-8 bottom-12 flex flex-col items-center pointer-events-none z-20">
                      <div className="bg-black/60 backdrop-blur-sm text-yellow-400 font-mono text-xs px-2 py-1 rounded mb-2 border border-white/10">
                        {formatTimeYT(activeSubtitle.startSeconds)} - {formatTimeYT(activeSubtitle.endSeconds)}
                      </div>
                      <textarea
                        value={activeSubtitle.text}
                        onChange={(e) => handleSubtitleTextChange(activeSubtitle.id, e.target.value)}
                        className="bg-black/80 backdrop-blur-sm text-white text-2xl md:text-3xl font-bold px-6 py-3 rounded-lg leading-relaxed text-center shadow-lg border border-white/10 resize-none outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/50 transition-all pointer-events-auto w-full max-w-3xl overflow-hidden"
                        dir={isRTL(activeSubtitle.text) ? "rtl" : "ltr"}
                        style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}
                        rows={Math.max(1, activeSubtitle.text.split('\n').length)}
                        onKeyDown={(e) => {
                          if (e.key === 'Space') {
                            e.stopPropagation();
                          }
                        }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Video size={48} className="mb-4 opacity-20" />
                  <p className="text-lg font-medium text-zinc-300">No media loaded</p>
                  <p className="text-sm mt-2 max-w-xs">Upload an audio or video file to start syncing your subtitles.</p>
                  <button
                    onClick={() => audioInputRef.current?.click()}
                    className="mt-6 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors"
                  >
                    Select Media File
                  </button>
                </>
              )}
              <input
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                ref={audioInputRef}
                onChange={handleAudioUpload}
              />
            </div>
            
            {/* Fake Video Player Controls Bar */}
            <div className="h-12 bg-zinc-900 border-t border-zinc-800 flex items-center px-4 shrink-0 z-20">
              <div className="text-xs font-mono text-zinc-400">
                {audioUrl ? "Ready to sync" : "Waiting for media..."}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Half: Timeline / Waveform */}
        <div className="h-[35vh] min-h-[250px] shrink-0 bg-zinc-900 flex flex-col">
          {audioUrl && mediaEl ? (
            <Waveform
              mediaElement={mediaEl}
              audioUrl={audioUrl}
              subtitles={subtitles}
              onSubtitlesChange={handleSubtitlesChange}
              onSubtitleSelect={setSelectedSubtitleId}
              selectedSubtitleId={selectedSubtitleId}
              onTimeUpdate={setCurrentTime}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600 bg-zinc-900">
              Timeline will appear here after loading media
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
