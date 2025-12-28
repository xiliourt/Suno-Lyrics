import { SunoClipMetadata, SunoWord } from '../types';

const DEFAULT_BASE_URL = 'https://studio-api.prod.suno.com/api';

/**
 * Helper to validate UUID format loosely
 */
export const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class APIError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'APIError';
  }
}

const getBaseUrl = (proxyUrl?: string) => {
  if (!proxyUrl) return DEFAULT_BASE_URL;
  // Remove trailing slash if present
  return proxyUrl.replace(/\/$/, '');
};

/**
 * Fetches the aligned lyrics (words with timestamps).
 */
export const fetchAlignedLyrics = async (songId: string, token?: string, proxyUrl?: string): Promise<SunoWord[]> => {
  try {
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const baseUrl = getBaseUrl(proxyUrl);
    const response = await fetch(`${baseUrl}/gen/${songId}/aligned_lyrics/v2`, {
      headers
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new APIError(`Unauthorized: Please provide a valid Suno session token.`, 401);
      }
      throw new APIError(`Failed to fetch aligned lyrics: ${response.statusText}`, response.status);
    }
    const data = await response.json();
    
    // Handle both direct array and wrapped object responses
    let rawWords: any[] = [];
    
    if (Array.isArray(data)) {
      rawWords = data;
    } else if (data && typeof data === 'object') {
       // Prioritize keys mentioned by user and common ones
       const potentialKeys = ['aligned_words', 'alligned_words', 'words', 'lyrics', 'aligned_lyrics'];
       
       for (const key of potentialKeys) {
         if (Array.isArray(data[key])) {
           rawWords = data[key];
           break;
         }
       }

       // Fallback: Recursive or shallow search for ANY array containing items with 'word' and 'start' (or start_s)
       if (rawWords.length === 0) {
          for (const key in data) {
             if (Array.isArray(data[key]) && data[key].length > 0) {
                 const firstItem = data[key][0];
                 // Duck typing to see if it looks like a Suno word object
                 if (firstItem && typeof firstItem === 'object' && 'word' in firstItem) {
                     rawWords = data[key];
                     break;
                 }
             }
          }
       }
       
       if (rawWords.length === 0) {
         console.warn("Fetched JSON object does not contain known lyrics array keys. Keys found:", Object.keys(data));
         console.warn("Full payload:", data);
       }
    }

    // Normalize keys (handle start_s/end_s vs start/end) and filter invalid items
    const normalizedWords: SunoWord[] = rawWords.map((w) => ({
      word: w.word,
      start: typeof w.start === 'number' ? w.start : (typeof w.start_s === 'number' ? w.start_s : undefined),
      end: typeof w.end === 'number' ? w.end : (typeof w.end_s === 'number' ? w.end_s : undefined),
      score: w.score ?? w.p_align
    })).filter((w: any): w is SunoWord => 
      Boolean(w && typeof w.word === 'string' && typeof w.start === 'number')
    );

    return normalizedWords;
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches the clip metadata (original prompt).
 */
export const fetchClipMetadata = async (clipId: string, token?: string, proxyUrl?: string): Promise<SunoClipMetadata> => {
  try {
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const baseUrl = getBaseUrl(proxyUrl);
    const response = await fetch(`${baseUrl}/clip/${clipId}`, {
      headers
    });

    if (!response.ok) {
        if (response.status === 401) {
          throw new APIError(`Unauthorized: Please provide a valid Suno session token.`, 401);
        }
        throw new APIError(`Failed to fetch clip metadata: ${response.statusText}`, response.status);
    }
    return await response.json();
  } catch (error) {
    throw error;
  }
};