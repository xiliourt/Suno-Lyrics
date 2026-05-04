export interface AlignedWord {
  word: string;
  start_s: number;
  end_s: number;
  success?: boolean;
  p_align?: number;
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

export type FileFormat = 'lrc' | 'srt';

export interface GenerationResult {
  lines: AlignedWord[][];
  lrcContent: string;
  srtContent: string;
}

export interface LyricAlignmentResponse {
  aligned_words: AlignedWord[];
}