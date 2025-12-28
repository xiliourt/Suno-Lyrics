import { AlignedLine, SunoWord } from '../types';

/**
 * Normalizes text for comparison: removes punctuation, lowercases.
 */
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Formats seconds into LRC timestamp [mm:ss.xx]
 */
const formatLrcTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}]`;
};

/**
 * Formats seconds into SRT timestamp HH:MM:SS,ms
 */
const formatSrtTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
};

/**
 * Main algorithm to align a stream of words to lines of text.
 * Enforces: Line Start = Start of first word. Line End = Start of next line's first word.
 */
export const alignLyrics = (promptText: string, alignedWords: SunoWord[]): AlignedLine[] => {
  // Split prompt into lines and clean whitespace
  const rawLines = promptText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const lines: AlignedLine[] = [];
  
  let wordCursor = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const lineText = rawLines[i];
    
    // Skip metadata tags (e.g., [Verse], [Chorus]) as they generally don't have corresponding audio words
    // We want to match actual lyrics.
    if (lineText.startsWith('[') && lineText.endsWith(']')) {
      continue;
    }

    const lineTokens = lineText.split(/\s+/).map(normalize).filter(t => t.length > 0);
    if (lineTokens.length === 0) continue;

    let matchIndex = -1;

    // Search for the start of this line in the aligned words
    // We scan forward from the current cursor to find the first matching word
    for (let w = wordCursor; w < alignedWords.length; w++) {
      const audioWord = normalize(alignedWords[w].word);
      
      // Primary Strategy: Match the first word of the line
      if (audioWord === lineTokens[0]) {
        matchIndex = w;
        
        // Optimization: If the line has multiple words, check the next word 
        // to confirm this is the correct instance of the word (avoiding false positives on common words like "I")
        if (lineTokens.length > 1 && w + 1 < alignedWords.length) {
             const nextAudioWord = normalize(alignedWords[w+1].word);
             if (nextAudioWord === lineTokens[1]) {
                 matchIndex = w; // High confidence match
                 break; 
             }
             // If 2nd word doesn't match, we might have found a stray word. 
             // However, for simplicity and to prevent skipping valid lines where the 2nd word was dropped,
             // we accept the first word match.
             break;
        } else {
             break;
        }
      }
    }

    // Fallback Strategy: If the first word wasn't found (singer skipped it or AI missed it),
    // try to anchor on the second word of the line.
    if (matchIndex === -1 && lineTokens.length > 1) {
       for (let w = wordCursor; w < alignedWords.length; w++) {
          if (normalize(alignedWords[w].word) === lineTokens[1]) {
             matchIndex = w; // We use the timestamp of the 2nd word as the approximate start
             break;
          }
       }
    }

    if (matchIndex !== -1) {
      // Found the line start
      const startTime = alignedWords[matchIndex].start;
      
      lines.push({
        text: lineText,
        startTime: startTime,
        endTime: 0, // Will be filled in the post-process step
        words: [] 
      });

      // Advance cursor. 
      // We set it to the match + 1 so the next line search starts after this word.
      wordCursor = matchIndex + 1;
    }
  }

  // Post-process: Set End Times
  // Requirement: "End at the start of the next line's first word"
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1];

    if (nextLine) {
      currentLine.endTime = nextLine.startTime;
    } else {
      // Last line: End at the end of the last word in the alignment data
      const lastWord = alignedWords[alignedWords.length - 1];
      if (lastWord && lastWord.end > currentLine.startTime) {
        currentLine.endTime = lastWord.end;
      } else {
        currentLine.endTime = currentLine.startTime + 5; // Default buffer if data missing
      }
    }
  }

  return lines;
};

export const generateLRC = (lines: AlignedLine[]): string => {
  return lines.map(line => `${formatLrcTime(line.startTime)}${line.text}`).join('\n');
};

export const generateSRT = (lines: AlignedLine[]): string => {
  return lines.map((line, index) => {
    return `${index + 1}\n${formatSrtTime(line.startTime)} --> ${formatSrtTime(line.endTime)}\n${line.text}\n`;
  }).join('\n');
};