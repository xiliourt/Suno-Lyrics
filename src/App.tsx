import React, { useState, useEffect, useRef } from 'react';
import { saveAs } from 'file-saver';
import { getLyricAlignment, getSunoClip, getSunoFeed, getSunoCredits } from './services/sunoApi';
import { matchWordsToPrompt, generateLrc, generateSrt } from './utils/lyrics';
import { parseLrcToLines, parseSrtToLines } from './utils/parseLyrics';
import { AlignedWord, SunoClipMetadata, LyricAlignmentResponse } from './types';
import { Settings, Play, Pause, ChevronDown, Download, Music, Key, History, FileText, ChevronUp, Save, Clock, Trash2, Library, Search, List, AlertCircle, CloudLightning } from 'lucide-react';
import { Footer } from './components/Footer';

const isValidUUID = (uuid: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid);

interface HistoryItem {
  id: string;
  title: string;
  lines: AlignedWord[][];
  lrcContent: string;
  srtContent: string;
  timestamp: number;
  prompt: string;
}

const formatTimeForInput = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60);
  const sInt = Math.floor(s);
  const ms = Math.round((s - sInt) * 100);
  return `${m.toString().padStart(2, '0')}:${sInt.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const parseTimeFromInput = (str: string) => {
  if (str.includes(':')) {
      const parts = str.split(':');
      const m = parseInt(parts[0], 10) || 0;
      const s = parseFloat(parts[1]) || 0;
      return (m * 60) + s;
  }
  return parseFloat(str) || 0;
};

const TimeInput: React.FC<{ 
  seconds: number; 
  onChange: (val: number) => void;
  className?: string;
}> = ({ seconds, onChange, className }) => {
  const [value, setValue] = useState(formatTimeForInput(seconds));
  useEffect(() => { setValue(formatTimeForInput(seconds)); }, [seconds]);

  const commit = () => {
    const newSecs = parseTimeFromInput(value);
    if (!isNaN(newSecs) && newSecs >= 0) {
      onChange(newSecs);
      setValue(formatTimeForInput(newSecs));
    } else {
      setValue(formatTimeForInput(seconds));
    }
  };

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`bg-transparent border-b border-transparent focus:border-indigo-500 hover:border-slate-700 outline-none text-center font-mono transition-colors ${className}`}
    />
  );
};

export default function App() {
  const [sunoCookie, setSunoCookie] = useState('');
  const [credits, setCredits] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [songId, setSongId] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeItem, setActiveItem] = useState<HistoryItem | null>(null);
  
  const [bulkCount, setBulkCount] = useState<number>(5);
  const [isBulking, setIsBulking] = useState(false);

  // Audio Playback

  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Editing state
  const [isEditingAsText, setIsEditingAsText] = useState(false);
  const [activeTab, setActiveTab] = useState<'lrc' | 'srt'>('lrc');
  const [textEditContent, setTextEditContent] = useState('');

  useEffect(() => {
    const storedCookie = localStorage.getItem('sunoCookie');
    const storedHistory = localStorage.getItem('sunoHistory');
    if (storedCookie) {
        setSunoCookie(storedCookie);
        testCredits(storedCookie);
    }
    if (storedHistory) {
      try { setHistory(JSON.parse(storedHistory)); } catch (e) {}
    }
  }, []);

  const saveSettings = () => {
    localStorage.setItem('sunoCookie', sunoCookie);
    setShowSettings(false);
    testCredits(sunoCookie);
  };

  const testCredits = async (cookie: string) => {
    if (!cookie) return;
    try {
      const c = await getSunoCredits(cookie);
      setCredits(c);
      setErrorMsg('');
    } catch (e: any) {
      setCredits(null);
      setErrorMsg("Failed to verify Suno Cookie: " + e.message);
      setShowSettings(true);
    }
  };

  const saveToHistory = (item: HistoryItem) => {
    const newHistory = [item, ...history.filter(h => h.id !== item.id)];
    setHistory(newHistory);
    localStorage.setItem('sunoHistory', JSON.stringify(newHistory));
    setActiveItem(item);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('sunoHistory');
    setActiveItem(null);
  };

  const requireCookie = () => {
    if (!sunoCookie) {
      setErrorMsg("Please enter your Suno Cookie in settings first.");
      setShowSettings(true);
      return false;
    }
    return true;
  };

  const handleFetchSingle = async () => {
    if (!requireCookie()) return;
    if (!songId || !isValidUUID(songId)) {
       setErrorMsg("Please enter a valid Suno Song ID.");
       return;
    }
    setIsFetching(true);
    setErrorMsg('');
    
    try {
      const [meta, alignment] = await Promise.all([
        getSunoClip(songId, sunoCookie),
        getLyricAlignment(songId, sunoCookie)
      ]);

      const prompt = meta.metadata?.prompt || "";
      const groups = matchWordsToPrompt(alignment.aligned_words, prompt);
      
      const item: HistoryItem = {
        id: meta.id,
        title: meta.title || "Untitled",
        lines: groups,
        lrcContent: generateLrc(groups),
        srtContent: generateSrt(groups),
        timestamp: Date.now(),
        prompt: prompt
      };
      
      saveToHistory(item);
      setSongId('');
    } catch (e: any) {
      setErrorMsg("Failed to fetch song: " + e.message);
    } finally {
      setIsFetching(false);
    }
  };

  const handleBulkExport = async () => {
    if (!requireCookie()) return;
    setIsBulking(true);
    setErrorMsg('');
    
    try {
      const feed = await getSunoFeed(sunoCookie, bulkCount);
      if (!feed || !feed.clips) throw new Error("Invalid feed response");
      
      let processed = 0;
      const newItems: HistoryItem[] = [];
      
      for (const clip of feed.clips) {
        if (clip.metadata?.prompt) {
           try {
             const alignment = await getLyricAlignment(clip.id, sunoCookie);
             if (alignment?.aligned_words?.length > 0) {
               const groups = matchWordsToPrompt(alignment.aligned_words, clip.metadata.prompt);
               const item: HistoryItem = {
                  id: clip.id,
                  title: clip.title || "Untitled",
                  lines: groups,
                  lrcContent: generateLrc(groups),
                  srtContent: generateSrt(groups),
                  timestamp: Date.now() + processed,
                  prompt: clip.metadata.prompt
               };
               newItems.push(item);
               processed++;
             }
           } catch (e) {
             console.warn("Skipping " + clip.id, e);
           }
        }
      }
      
      if (processed > 0) {
        setHistory(prev => {
            const combined = [...newItems.reverse(), ...prev];
            // Remove duplicates by ID to avoid overlapping imports
            const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
            localStorage.setItem('sunoHistory', JSON.stringify(unique));
            return unique;
        });
        if (!activeItem && newItems.length > 0) setActiveItem(newItems[newItems.length - 1]);
        setErrorMsg(`Successfully imported ${processed} songs to history.`);
        setTimeout(() => setErrorMsg(''), 4000);
      } else {
        setErrorMsg("No songs with alignments found in the recent feed.");
      }
    } catch (e: any) {
       setErrorMsg("Bulk export failed: " + e.message);
    } finally {
       setIsBulking(false);
    }
  };

  // Editor Actions
  const updateLineTimestamp = (index: number, start: boolean, val: number) => {
    if (!activeItem) return;
    const newLines = [...activeItem.lines];
    const line = [...newLines[index]];
    if (line.length > 0) {
      if (start) {
        line[0] = { ...line[0], start_s: Math.max(0, val) };
      } else {
        line[line.length - 1] = { ...line[line.length - 1], end_s: Math.max(0, val) };
      }
      newLines[index] = line;
      rebuildAndSaveContent(newLines);
    }
  };

  const updateLineText = (index: number, text: string) => {
    if (!activeItem) return;
    const newLines = [...activeItem.lines];
    const oldLine = newLines[index];
    if (oldLine.length > 0) {
      newLines[index] = [{ 
        ...oldLine[0], 
        word: text, 
        end_s: oldLine[oldLine.length - 1].end_s 
      }];
      rebuildAndSaveContent(newLines);
    }
  };

  const shiftAllLines = (amount: number) => {
    if (!activeItem) return;
    const newLines = activeItem.lines.map(line => 
      line.map(w => ({
        ...w,
        start_s: Math.max(0, w.start_s + amount),
        end_s: Math.max(0, w.end_s + amount)
      }))
    );
    rebuildAndSaveContent(newLines);
  };

  const rebuildAndSaveContent = (newLines: AlignedWord[][]) => {
    if (!activeItem) return;
    const newItem = {
      ...activeItem,
      lines: newLines,
      lrcContent: generateLrc(newLines),
      srtContent: generateSrt(newLines)
    };
    saveToHistory(newItem);
  };
  
  const handleAudioTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };
  
  const togglePlayLine = (start_s: number) => {
    if (audioRef.current) {
        audioRef.current.currentTime = start_s;
        audioRef.current.play();
        setIsPlaying(true);
    }
  };

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleTextEdit = () => {
    if (isEditingAsText) {
       setIsEditingAsText(false);
       if (activeItem) {
          let newLines: AlignedWord[][] = [];
          if (activeTab === 'lrc') {
             newLines = parseLrcToLines(textEditContent);
          } else {
             newLines = parseSrtToLines(textEditContent);
          }
          if (newLines.length > 0) {
             rebuildAndSaveContent(newLines);
          } else {
             const newItem = {
                ...activeItem,
                ...(activeTab === 'lrc' ? { lrcContent: textEditContent } : { srtContent: textEditContent }),
                lines: []
             };
             saveToHistory(newItem);
          }
       }
    } else {
       setTextEditContent(activeTab === 'lrc' ? activeItem!.lrcContent : activeItem!.srtContent);
       setIsEditingAsText(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-indigo-500/30">
      
      {/* Top Navbar */}
      <nav className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-50 flex items-center justify-between">
         <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                 <Music className="w-5 h-5" />
             </div>
             <h1 className="font-bold text-slate-100 hidden sm:block">Suno Lyrics</h1>
         </div>
         <div className="flex z-50 gap-3">
             {credits !== null && (
               <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg text-xs font-semibold text-slate-400">
                  <CloudLightning className="w-4 h-4 text-emerald-400" />
                  {credits} CR
               </div>
             )}
             <button 
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2 transition-all text-xs font-bold" 
                title="Suno Configuration"
             >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                <span className="hidden sm:block">Suno API</span>
             </button>
         </div>
      </nav>

      {/* Settings Modal overlay */}
      {showSettings && (
         <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-5 animate-in zoom-in-95 duration-200">
               <div className="flex justify-between items-center mb-2">
                 <h2 className="text-lg font-bold text-white flex items-center gap-2">
                   <Key className="w-5 h-5 text-indigo-400" /> API Configuration
                 </h2>
                 <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-slate-300">&times;</button>
               </div>
               
               <div className="space-y-3">
                 <div className="bg-slate-950/50 border border-indigo-500/20 rounded-xl p-4">
                    <div className="flex justify-between items-start mb-2">
                       <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Auto-Get Token Script</h3>
                       <button onClick={() => {
                           const script = `await (async function() {\n    const sessionCookie = await window.Clerk.session.getToken();\n\n    if (sessionCookie) {\n        console.log("%c Suno Session Token Found! ", "background: #222; color: #bada55; font-size: 14px;");\n        console.log(sessionCookie);\n        copy(sessionCookie); \n        console.log("%c Result copied to clipboard automatically.", "color: gray;");\n    } else {\n        console.error("Session token not found. Make sure you are logged in at suno.com");\n    }\n})();`;
                           navigator.clipboard.writeText(script);
                       }} type="button" className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 border flex items-center space-x-2 bg-slate-700/50 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">
                           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z"></path><path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z"></path></svg>
                           <span>Copy Script</span>
                       </button>
                    </div>
                    <p className="text-xs text-slate-400 mb-3">1. Go to suno.com and log in.<br/>2. Open Developer Tools (F12) &gt; Console.<br/>3. Paste this code and hit Enter.</p>
                    <div className="bg-black/50 rounded-lg p-3 overflow-x-auto border border-white/5 shadow-inner">
                       <pre className="text-[10px] font-mono text-slate-400 whitespace-pre-wrap">
{`await (async function() {
    const sessionCookie = await window.Clerk.session.getToken();

    if (sessionCookie) {
        console.log("%c Suno Session Token Found! ", "background: #222; color: #bada55; font-size: 14px;");
        console.log(sessionCookie);
        copy(sessionCookie); 
        console.log("%c Result copied to clipboard automatically.", "color: gray;");
    } else {
        console.error("Session token not found. Make sure you are logged in at suno.com");
    }
})();`}
                       </pre>
                    </div>
                 </div>

                 <label className="block text-sm font-semibold text-slate-300 mt-4">Suno Cookie (Session Token)</label>
                 <textarea
                   value={sunoCookie}
                   onChange={e => setSunoCookie(e.target.value)}
                   className="w-full h-24 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono resize-none text-slate-400"
                   placeholder="Paste your Suno __session cookie here..."
                 />
               </div>

               <button 
                 onClick={saveSettings}
                 className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-lg transition-colors mt-2"
               >
                 Save & Test Credentials
               </button>
            </div>
         </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-8">
         
         {/* Error Alert */}
         {errorMsg && (
           <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{errorMsg}</p>
           </div>
         )}
         
         {/* Action Bar: Fetch Single & Bulk */}
         <div className="grid md:grid-cols-2 gap-4">
            
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
               <h3 className="font-bold text-slate-100 flex items-center gap-2">
                 <Search className="w-4 h-4 text-indigo-400" /> Fetch Single Track
               </h3>
               <div className="flex gap-2">
                 <input 
                   value={songId}
                   onChange={e => setSongId(e.target.value)}
                   type="text" 
                   placeholder="Enter Suno Song UUID..."
                   className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                 />
                 <button 
                   onClick={handleFetchSingle}
                   disabled={isFetching || !songId}
                   className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold text-sm transition-colors whitespace-nowrap"
                 >
                   {isFetching ? 'Loading...' : 'Fetch'}
                 </button>
               </div>
            </div>

             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
               <h3 className="font-bold text-slate-100 flex items-center gap-2">
                 <Library className="w-4 h-4 text-emerald-400" /> Import From Feed
               </h3>
               <div className="flex items-center gap-3">
                 <div className="relative">
                   <select 
                     value={bulkCount}
                     onChange={(e) => setBulkCount(Number(e.target.value))}
                     className="appearance-none bg-slate-950 border border-slate-800 rounded-lg pl-4 pr-10 py-2.5 text-sm outline-none focus:border-emerald-500 text-slate-300"
                   >
                     <option value={5}>Last 5</option>
                     <option value={10}>Last 10</option>
                     <option value={20}>Last 20</option>
                   </select>
                   <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                 </div>
                 <button 
                   onClick={handleBulkExport}
                   disabled={isBulking}
                   className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg px-4 py-2.5 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                 >
                   {isBulking ? (
                      <Clock className="w-4 h-4 animate-spin" />
                   ) : (
                      <Download className="w-4 h-4" />
                   )}
                   {isBulking ? 'Importing...' : 'Import to History'}
                 </button>
               </div>
            </div>

         </div>

         {/* Workspace Grid */}
         <div className="grid lg:grid-cols-12 gap-6 items-start">
            
            {/* History Sidebar */}
            <div className="lg:col-span-3 space-y-4">
               <div className="flex items-center justify-between">
                 <h3 className="font-bold text-slate-300 text-sm flex items-center gap-2 uppercase tracking-wide">
                   <Clock className="w-4 h-4" /> History
                 </h3>
                 {history.length > 0 && (
                   <button onClick={clearHistory} className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1">
                     <Trash2 className="w-3 h-3" /> Clear
                   </button>
                 )}
               </div>
               
               <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                 {history.length === 0 && <p className="text-xs text-slate-500 italic">No songs loaded yet.</p>}
                 {history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => { setActiveItem(item); setIsPlaying(false); }}
                      className={`w-full text-left p-3 rounded-xl border text-sm transition-all flex flex-col gap-1 ${
                        activeItem?.id === item.id 
                           ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-100 shadow-[0_0_15px_rgba(99,102,241,0.1)]' 
                           : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <span className="font-semibold truncate w-full block">{item.title}</span>
                      <span className="text-[10px] opacity-60 flex items-center gap-1">
                         {new Date(item.timestamp).toLocaleTimeString()} • {item.lines.length} lines
                      </span>
                    </button>
                 ))}
               </div>
            </div>

            {/* Active Output Editor */}
            <div className="lg:col-span-9">
               {activeItem ? (
                 <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[700px]">
                    
                    {/* Editor Top Bar with Audio & Settings */}
                    <div className="p-4 bg-slate-900 border-b border-slate-800 flex flex-wrap gap-4 items-center justify-between sticky top-0 z-20 shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
                       
                       <div className="flex-1 min-w-[200px] flex items-center gap-3 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                          <button onClick={handlePlayPause} className="w-8 h-8 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-colors shrink-0">
                             {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                          </button>
                          <div className="flex-1 flex flex-col">
                             <div className="text-xs font-semibold text-slate-200 truncate pr-2 max-w-[200px]">{activeItem.title}</div>
                             <div className="text-[10px] text-slate-500 font-mono">{formatTimeForInput(currentTime)}</div>
                          </div>
                          <audio 
                             ref={audioRef}
                             src={`https://cdn1.suno.ai/${activeItem.id}.mp3`}
                             onTimeUpdate={handleAudioTimeUpdate}
                             onEnded={() => setIsPlaying(false)}
                             className="hidden"
                             controls={false}
                          />
                       </div>

                       <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest mr-2">Shift All</span>
                          <button onClick={() => shiftAllLines(-0.1)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold font-mono transition-colors text-slate-300">-0.1s</button>
                          <button onClick={() => shiftAllLines(0.1)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold font-mono transition-colors text-slate-300">+0.1s</button>
                       </div>
                    </div>

                    <div className="flex flex-1 flex-col md:flex-row overflow-hidden relative bg-slate-950">
                       
                       {/* Lines Live Editor */}
                       <div className={`md:w-1/2 flex flex-col border-r border-slate-800 transition-opacity ${isEditingAsText ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                          <div className="p-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10 flex items-center justify-between">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                              <List className="w-3.5 h-3.5" /> Adjust Timings
                            </h3>
                          </div>
                          <div className="flex-1 overflow-y-auto p-3 space-y-2">
                             {activeItem.lines.map((line, idx) => {
                               if (line.length === 0) return null;
                               const start = line[0].start_s;
                               const end = line[line.length - 1].end_s;
                               const text = line.map(w => w.word).join(' ');
                               const isCurrent = currentTime >= start && currentTime < end;
                               
                               return (
                                 <div 
                                   key={idx} 
                                   className={`group p-3 rounded-xl border transition-all ${isCurrent ? 'bg-indigo-500/10 border-indigo-500/40 shadow-sm shadow-indigo-500/10' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-900 hover:border-slate-700'}`}
                                 >
                                    <div className="flex justify-between items-center text-xs font-mono mb-2">
                                       <div className="flex items-center gap-1">
                                          <button onClick={() => updateLineTimestamp(idx, true, Math.max(0, start - 0.1))} className={`px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isCurrent ? 'text-indigo-300 hover:text-indigo-100' : 'text-slate-500 hover:text-slate-300'}`}>-</button>
                                          <TimeInput 
                                             seconds={start} 
                                             onChange={(v) => updateLineTimestamp(idx, true, v)} 
                                             className={`w-[65px] text-center ${isCurrent ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-400'}`}
                                          />
                                          <button onClick={() => updateLineTimestamp(idx, true, start + 0.1)} className={`px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isCurrent ? 'text-indigo-300 hover:text-indigo-100' : 'text-slate-500 hover:text-slate-300'}`}>+</button>
                                       </div>
                                       <div className="h-px bg-slate-800 flex-1 mx-3" />
                                       <div className="flex items-center gap-1">
                                          <button onClick={() => updateLineTimestamp(idx, false, Math.max(0, end - 0.1))} className={`px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isCurrent ? 'text-indigo-300 hover:text-indigo-100' : 'text-slate-500 hover:text-slate-300'}`}>-</button>
                                          <TimeInput 
                                             seconds={end} 
                                             onChange={(v) => updateLineTimestamp(idx, false, v)} 
                                             className={`w-[65px] text-center ${isCurrent ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-400'}`}
                                          />
                                          <button onClick={() => updateLineTimestamp(idx, false, end + 0.1)} className={`px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isCurrent ? 'text-indigo-300 hover:text-indigo-100' : 'text-slate-500 hover:text-slate-300'}`}>+</button>
                                       </div>
                                       <button 
                                          onClick={() => togglePlayLine(start)}
                                          className={`ml-3 p-1 rounded-md transition-colors ${isCurrent ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 opacity-0 group-hover:opacity-100'}`}
                                       >
                                          <Play className="w-3 h-3 ml-0.5" />
                                       </button>
                                    </div>
                                    <input
                                      type="text"
                                      value={text}
                                      onChange={(e) => updateLineText(idx, e.target.value)}
                                      className={`w-full bg-transparent border-none p-0 text-sm focus:outline-none transition-colors ${isCurrent ? 'text-indigo-100 font-medium' : 'text-slate-300 group-hover:text-slate-200'}`}
                                    />
                                 </div>
                               )
                             })}
                             {activeItem.lines.length === 0 && (
                                <div className="text-slate-500 italic p-4 flex flex-col items-center justify-center mt-10 gap-2">
                                   <AlertCircle className="w-8 h-8 opacity-50" />
                                   <p>No synchronized lines found.</p>
                                </div>
                             )}
                          </div>
                       </div>

                       {/* File Output Reader */}
                       <div className="md:w-1/2 flex flex-col">
                          
                          <div className="flex border-b border-slate-800 bg-slate-900/50">
                             <button
                               onClick={() => setActiveTab('lrc')}
                               className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors ${activeTab === 'lrc' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-slate-900' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                             >
                               LRC
                             </button>
                             <button
                               onClick={() => setActiveTab('srt')}
                               className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors ${activeTab === 'srt' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-slate-900' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                             >
                               SRT
                             </button>
                          </div>
                          
                          <div className="flex-1 relative">
                             {isEditingAsText ? (
                               <textarea
                                 value={textEditContent}
                                 onChange={(e) => setTextEditContent(e.target.value)}
                                 className="w-full h-full bg-transparent p-5 text-sm font-mono text-emerald-400 resize-none outline-none leading-relaxed"
                                 spellCheck={false}
                               />
                             ) : (
                               <textarea
                                 readOnly
                                 value={activeTab === 'lrc' ? activeItem.lrcContent : activeItem.srtContent}
                                 className="w-full h-full bg-transparent p-5 text-sm font-mono text-slate-400 resize-none outline-none leading-relaxed selection:bg-indigo-500/30"
                               />
                             )}
                          </div>

                          <div className="p-3 border-t border-slate-800 bg-slate-900 flex justify-between items-center gap-3">
                             <button
                               onClick={toggleTextEdit}
                               className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${isEditingAsText ? 'bg-emerald-600/20 text-emerald-400' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                             >
                               <FileText className="w-3.5 h-3.5" /> {isEditingAsText ? 'Finish Raw Edit' : 'Edit Raw Text'}
                             </button>
                             
                             <button
                               onClick={() => {
                                 const content = isEditingAsText ? textEditContent : (activeTab === 'lrc' ? activeItem.lrcContent : activeItem.srtContent);
                                 const blob = new Blob([content], { type: 'text/plain' });
                                 saveAs(blob, `${activeItem.title.replace(/[^a-z0-9]/gi, '_')}.${activeTab}`);
                               }}
                               className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-2 transition-colors shadow-lg shadow-indigo-500/20 active:scale-95"
                             >
                               <Download className="w-3.5 h-3.5" /> Save {activeTab.toUpperCase()}
                             </button>
                          </div>
                       </div>
                    </div>
                 </div>
               ) : (
                 <div className="h-[700px] border-2 border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-500 bg-slate-900/30">
                    <Music className="w-12 h-12 mb-4 opacity-50 text-indigo-500" />
                    <p className="font-semibold text-sm">Select a song from history or fetch a new one.</p>
                 </div>
               )}
            </div>
         </div>
      </main>
      <Footer />
    </div>
  );
}