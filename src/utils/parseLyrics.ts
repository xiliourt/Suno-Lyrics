import { AlignedWord } from '../types';

export const parseLrcToLines = (lrcContent: string): AlignedWord[][] => {
    const lines = lrcContent.split('\n');
    const result: AlignedWord[][] = [];
    
    for (const line of lines) {
        const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
        if (match) {
            const m = parseInt(match[1], 10);
            const s = parseInt(match[2], 10);
            const ms = parseInt(match[3].padEnd(3, '0'), 10);
            const timeS = m * 60 + s + (ms / 1000);
            const text = match[4].trim();
            if (text) {
                result.push([{ word: text, start_s: timeS, end_s: timeS + 2, p_align: 1.0, success: true }]);
            }
        }
    }
    
    for (let i = 0; i < result.length - 1; i++) {
        if (result[i].length > 0 && result[i+1].length > 0) {
            result[i][0].end_s = Math.max(result[i][0].start_s, result[i+1][0].start_s);
        }
    }
    return result;
};

export const parseSrtToLines = (srtContent: string): AlignedWord[][] => {
    const blocks = srtContent.split(/\n\s*\n/).filter(b => b.trim());
    const result: AlignedWord[][] = [];
    
    for (const block of blocks) {
        const lines = block.split('\n').filter(l => l.trim());
        if (lines.length >= 3) {
            const timeLine = lines[1];
            const text = lines.slice(2).join(' ').trim();
            
            const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
            if (timeMatch) {
                const parseTime = (h: string, m: string, s: string, ms: string) => {
                    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + (parseInt(ms, 10) / 1000);
                };
                
                const startS = parseTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
                const endS = parseTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
                
                if (text) {
                    result.push([{ word: text, start_s: startS, end_s: endS, p_align: 1.0, success: true }]);
                }
            }
        }
    }
    return result;
};