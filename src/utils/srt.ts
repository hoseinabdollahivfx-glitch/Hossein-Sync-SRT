import Parser from 'srt-parser-2';
import { Subtitle } from '../types';

export const parseSrt = (srtText: string): Subtitle[] => {
  const parser = new Parser();
  const parsed = parser.fromSrt(srtText);
  return parsed.map(p => ({
    id: p.id,
    startSeconds: p.startSeconds,
    endSeconds: p.endSeconds,
    text: p.text
  }));
};

export const exportSrt = (subtitles: Subtitle[]): string => {
  const parser = new Parser();
  const srtArray = subtitles.map((sub, index) => ({
    id: (index + 1).toString(),
    startTime: formatTime(sub.startSeconds),
    endTime: formatTime(sub.endSeconds),
    startSeconds: sub.startSeconds,
    endSeconds: sub.endSeconds,
    text: sub.text
  }));
  return parser.toSrt(srtArray);
};

export const formatTime = (seconds: number): string => {
  const date = new Date(0);
  date.setUTCMilliseconds(Math.floor(seconds * 1000));
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms}`;
};

export const formatTimeYT = (seconds: number): string => {
  const date = new Date(0);
  date.setUTCMilliseconds(Math.floor(seconds * 1000));
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
};

export const parseTimeYT = (timeStr: string): number => {
  // Supports HH:MM:SS.mmm or HH:MM:SS,mmm
  const cleanStr = timeStr.replace(',', '.');
  const parts = cleanStr.split(':');
  if (parts.length === 3) {
    const secParts = parts[2].split('.');
    const sec = parseInt(secParts[0]) || 0;
    const ms = secParts[1] ? parseInt(secParts[1].padEnd(3, '0')) : 0;
    return (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 + sec + (ms / 1000);
  }
  return 0;
};
