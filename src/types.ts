export interface SunoWord {
  word: string;
  start: number; // Seconds
  end: number;   // Seconds
  score?: number;
}

export interface SunoClipMetadata {
  id: string;
  metadata: {
    prompt: string;
    tags?: string;
    duration?: number;
  };
  audio_url?: string;
  title?: string;
}

export interface AlignedLine {
  text: string;
  startTime: number;
  endTime: number;
  words: SunoWord[];
}

export type FileFormat = 'lrc' | 'srt';

export interface GenerationResult {
  lines: AlignedLine[];
  lrcContent: string;
  srtContent: string;
}