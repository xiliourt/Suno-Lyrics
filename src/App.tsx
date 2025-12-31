import React, { useState, useEffect, useRef } from 'react';
import { fetchAlignedLyrics, fetchClipMetadata, isValidUUID, APIError } from './services/api';
import Footer from './components/footer';
import { alignLyrics, generateLRC, generateSRT } from './utils/alignment';
import { GenerationResult, SunoClipMetadata, SunoWord, AlignedLine } from './types';
import { 
  Music, 
  Download, 
  Copy, 
  Loader2, 
  AlertTriangle, 
  FileText, 
  Check, 
  FileJson, 
  ArrowRight,
  Lock,
  ChevronDown,
  ChevronUp,
  Terminal,
  Key,
  Globe
} from './components/Icons';

enum AppState {
  IDLE,
  LOADING,
  SUCCESS,
  ERROR,
  MANUAL_INPUT
}

const TOKEN_INSTRUCTION_SNIPPET = `(function() {
    const sessionCookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('__session='))
        ?.split('=')[1];

    if (sessionCookie) {
        console.log("%c Suno Session Token Found! ", "background: #222; color: #bada55; font-size: 14px;");
        console.log(sessionCookie);
        copy(sessionCookie); 
        console.log("%c Result copied to clipboard automatically.", "color: gray;");
    } else {
        console.error("Session token not found. Make sure you are logged in at suno.com");
    }
})();`;

// Helper for Time Input
const formatTimeForInput = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60);
  const sInt = Math.floor(s);
  const ms = Math.round((s - sInt) * 100);
  return `${m.toString().padStart(2, '0')}:${sInt.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const parseTimeFromInput = (str: string) => {
  // Supports mm:ss.xx or just seconds
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

  useEffect(() => {
    setValue(formatTimeForInput(seconds));
  }, [seconds]);

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
      className={`bg-transparent border-b border-transparent focus:border-indigo-500 hover:border-zinc-700 outline-none text-center font-mono transition-colors ${className}`}
    />
  );
};

const App: React.FC = () => {
  const [songId, setSongId] = useState('');
  const [sunoToken, setSunoToken] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [showTokenHelp, setShowTokenHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [metadata, setMetadata] = useState<SunoClipMetadata | null>(null);
  const [activeTab, setActiveTab] = useState<'lrc' | 'srt'>('lrc');
  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);

  // Manual Input State
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualJson, setManualJson] = useState('');

  const handleFetch = async () => {
    if (!songId || !isValidUUID(songId)) {
      setErrorMsg("Please enter a valid Suno Song ID (UUID).");
      setAppState(AppState.ERROR);
      return;
    }

    setAppState(AppState.LOADING);
    setErrorMsg('');

    try {
      // Pass the token and proxyUrl (if any) to both fetch calls
      const [words, meta] = await Promise.all([
        fetchAlignedLyrics(songId, sunoToken, proxyUrl),
        fetchClipMetadata(songId, sunoToken, proxyUrl)
      ]);

      processData(meta.metadata.prompt, words, meta);
    } catch (err: any) {
      console.error(err);
      let msg = "An unexpected error occurred.";
      if (err instanceof APIError) {
        msg = err.message;
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
         msg = "CORS Error: The browser blocked the request. Suno APIs do not allow direct browser access.";
         if (!proxyUrl) {
           msg += " Please configure a Proxy URL in settings below or use Manual Mode.";
         }
      }
      setErrorMsg(msg);
      setAppState(AppState.ERROR);
    }
  };

  const processData = (promptText: string, words: SunoWord[], meta?: SunoClipMetadata) => {
    if (!promptText) {
      setErrorMsg("No lyrics found in metadata.");
      setAppState(AppState.ERROR);
      return;
    }
    // We check length > 0, but we also print what we got if it fails to help debug
    if (!words || words.length === 0) {
      console.warn("Empty words array received after parsing. Prompt start:", promptText.substring(0, 50));
      setErrorMsg("No aligned lyrics data found. The API response might have been empty or had an unrecognized structure.");
      setAppState(AppState.ERROR);
      return;
    }

    try {
      const alignedLines = alignLyrics(promptText, words);
      const lrc = generateLRC(alignedLines);
      const srt = generateSRT(alignedLines);

      setResult({
        lines: alignedLines,
        lrcContent: lrc,
        srtContent: srt
      });
      if (meta) setMetadata(meta);
      setAppState(AppState.SUCCESS);
    } catch (e) {
      console.error(e);
      setErrorMsg("Error processing lyrics alignment. Check console for details.");
      setAppState(AppState.ERROR);
    }
  };

  const handleManualProcess = () => {
    try {
      const parsed = JSON.parse(manualJson);
      let rawWords: any[] = [];

      if (Array.isArray(parsed)) {
        rawWords = parsed;
      } else if (parsed && typeof parsed === 'object') {
        // Robust extraction matching api.ts logic
        const potentialKeys = ['aligned_words', 'alligned_words', 'words', 'lyrics', 'aligned_lyrics'];
        for (const key of potentialKeys) {
          if (Array.isArray(parsed[key])) {
            rawWords = parsed[key];
            break;
          }
        }
        
        if (rawWords.length === 0) {
           // Fallback scan
           for (const key in parsed) {
             if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
                const firstItem = parsed[key][0];
                if (firstItem && typeof firstItem === 'object' && 'word' in firstItem) {
                    rawWords = parsed[key];
                    break;
                }
             }
           }
        }
        
        if (rawWords.length === 0) throw new Error("Could not find a valid lyrics array in the JSON object.");
      } else {
         throw new Error("JSON must be an array of words or an object containing them.");
      }

      // Normalize keys
      const normalizedWords: SunoWord[] = rawWords.map((w: any) => ({
          word: w.word,
          start: typeof w.start === 'number' ? w.start : (typeof w.start_s === 'number' ? w.start_s : undefined),
          end: typeof w.end === 'number' ? w.end : (typeof w.end_s === 'number' ? w.end_s : undefined),
          score: w.score ?? w.p_align
      })).filter((w: any): w is SunoWord => 
        Boolean(w && typeof w.word === 'string' && typeof w.start === 'number')
      );

      if (normalizedWords.length === 0) {
        throw new Error("Found array, but items are missing 'word' or 'start/start_s' properties.");
      }
      
      processData(manualPrompt, normalizedWords);
    } catch (e: any) {
      setErrorMsg(e.message || "Invalid JSON format. Please check your input.");
    }
  };

  const updateLine = (index: number, changes: Partial<AlignedLine>) => {
    if (!result) return;
    const newLines = [...result.lines];
    newLines[index] = { ...newLines[index], ...changes };
    
    const lrc = generateLRC(newLines);
    const srt = generateSRT(newLines);
    
    setResult({
      ...result,
      lines: newLines,
      lrcContent: lrc,
      srtContent: srt
    });
  };

  const copyToClipboard = () => {
    if (!result) return;
    const content = activeTab === 'lrc' ? result.lrcContent : result.srtContent;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(TOKEN_INSTRUCTION_SNIPPET);
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 2000);
  };

  const downloadFile = () => {
    if (!result) return;
    const content = activeTab === 'lrc' ? result.lrcContent : result.srtContent;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${metadata?.title || 'suno_lyrics'}.${activeTab}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 flex flex-col items-center">
      <header className="max-w-4xl w-full mb-12 text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 mb-4 shadow-lg shadow-indigo-500/20">
          <Music className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
          Suno Lyric Aligner
        </h1>
        <p className="text-zinc-400 text-lg max-w-xl mx-auto">
          Generate perfectly synchronized LRC and SRT files from your Suno tracks.
        </p>
      </header>

      <main className="max-w-4xl w-full space-y-8">
        {/* Input Section */}
        {appState !== AppState.SUCCESS && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 md:p-8 backdrop-blur-xl shadow-xl transition-all">
            {appState === AppState.MANUAL_INPUT ? (
              <div className="space-y-6">
                 <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                      <FileJson className="w-5 h-5 text-indigo-400" />
                      Manual Input Mode
                    </h2>
                    <button 
                      onClick={() => { setAppState(AppState.IDLE); setErrorMsg(''); }}
                      className="text-sm text-zinc-400 hover:text-white underline"
                    >
                      Back to Auto-Fetch
                    </button>
                 </div>
                 <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-300">Metadata Prompt (Lyrics)</label>
                      <textarea 
                        className="w-full h-64 bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none font-mono"
                        placeholder="Paste the full lyrics text here..."
                        value={manualPrompt}
                        onChange={(e) => setManualPrompt(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-300">Aligned Lyrics JSON</label>
                      <textarea 
                        className="w-full h-64 bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none font-mono"
                        placeholder='Paste JSON: [{"word": "Hello", "start_s": 1.0, "end_s": 1.5}, ...]'
                        value={manualJson}
                        onChange={(e) => setManualJson(e.target.value)}
                      />
                    </div>
                 </div>
                 {errorMsg && (
                    <div className="bg-red-500/10 text-red-400 p-4 rounded-lg flex items-start gap-3 text-sm">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <p>{errorMsg}</p>
                    </div>
                  )}
                 <button
                  onClick={handleManualProcess}
                  disabled={!manualPrompt || !manualJson}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                >
                  Generate Files <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Song ID Input */}
                <div className="space-y-2">
                  <label htmlFor="songId" className="block text-sm font-medium text-zinc-300 ml-1">
                    Enter Suno Song ID
                  </label>
                  <div className="relative">
                    <input
                      id="songId"
                      type="text"
                      value={songId}
                      onChange={(e) => setSongId(e.target.value)}
                      placeholder="e.g. 848f921e-d820-424a-b50a-..."
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-zinc-600 pl-12"
                    />
                    <Music className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-500 font-mono hidden md:block">
                      UUID v4
                    </div>
                  </div>
                </div>

                {/* Token Input Section */}
                <div className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label htmlFor="token" className="block text-sm font-medium text-zinc-300 ml-1 flex items-center gap-2">
                          <Lock className="w-3 h-3 text-zinc-500" />
                          Suno Session Token <span className="text-zinc-500 font-normal">(Optional, for private songs)</span>
                        </label>
                        <button 
                          onClick={() => setShowTokenHelp(!showTokenHelp)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                        >
                          How do I get this?
                          {showTokenHelp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          id="token"
                          type="password"
                          autoComplete="off"
                          value={sunoToken}
                          onChange={(e) => setSunoToken(e.target.value)}
                          placeholder="Paste your session token here..."
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-zinc-600 pl-12 font-mono"
                        />
                        <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      </div>
                    </div>

                    {/* Token Help Accordion */}
                    {showTokenHelp && (
                      <div className="bg-zinc-950/50 border border-zinc-800/50 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex items-start gap-3">
                           <div className="bg-indigo-500/10 p-2 rounded-lg shrink-0">
                             <Terminal className="w-4 h-4 text-indigo-400" />
                           </div>
                           <div className="space-y-2 text-sm text-zinc-400">
                              <p>
                                To access private songs, you need your session token. 
                                Log in to <a href="https://suno.com" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">suno.com</a>, 
                                open the browser console (F12), and paste this snippet:
                              </p>
                              <div className="relative group">
                                <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 overflow-x-auto">
                                  {TOKEN_INSTRUCTION_SNIPPET}
                                </pre>
                                <button 
                                  onClick={copySnippet}
                                  className="absolute top-2 right-2 p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-400 hover:text-white transition-colors"
                                  title="Copy Snippet"
                                >
                                  {snippetCopied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                              <p className="text-xs text-zinc-500">
                                This runs locally in your browser to read your own cookie. We do not store this token.
                              </p>
                           </div>
                        </div>
                      </div>
                    )}
                </div>

                {/* Settings / Proxy Section */}
                <div className="space-y-2 pt-2">
                   <button 
                      onClick={() => setShowSettings(!showSettings)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                    >
                      {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      Advanced Settings (Proxy / CORS)
                   </button>
                   
                   {showSettings && (
                     <div className="bg-zinc-950/50 border border-zinc-800/50 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="space-y-2">
                          <label htmlFor="proxy" className="block text-sm font-medium text-zinc-300 flex items-center gap-2">
                            <Globe className="w-3 h-3 text-zinc-500" />
                            Proxy URL <span className="text-zinc-500 font-normal">(Cloudflare Worker)</span>
                          </label>
                          <input
                            id="proxy"
                            type="text"
                            value={proxyUrl}
                            onChange={(e) => setProxyUrl(e.target.value)}
                            placeholder="e.g. https://my-worker.workers.dev"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-zinc-600"
                          />
                          <p className="text-[10px] text-zinc-500">
                            Deploy <code>worker.js</code> to Cloudflare to bypass CORS issues. Leave empty for direct connection.
                          </p>
                        </div>
                     </div>
                   )}
                </div>

                {errorMsg && (
                  <div className="bg-red-500/10 text-red-400 p-4 rounded-lg flex items-start gap-3 text-sm border border-red-500/20">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <p className="font-medium">{errorMsg}</p>
                      {errorMsg.includes("CORS") && (
                        <p className="text-red-300/80">
                          Try using a browser extension like "Allow CORS" or switch to 
                          <button onClick={() => setAppState(AppState.MANUAL_INPUT)} className="mx-1 underline text-indigo-400 hover:text-indigo-300">Manual Mode</button>
                          to paste the data directly.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleFetch}
                  disabled={appState === AppState.LOADING}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                >
                  {appState === AppState.LOADING ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Fetching Data...
                    </>
                  ) : (
                    <>
                      Fetch & Generate <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
                
                <div className="text-center">
                   <button onClick={() => setAppState(AppState.MANUAL_INPUT)} className="text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors">
                     Having trouble? Enter data manually
                   </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results Section */}
        {appState === AppState.SUCCESS && result && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-6">
            
            <div className="flex items-center justify-between mb-4">
               <h2 className="text-2xl font-bold text-white">Generated Subtitles</h2>
               <button 
                onClick={() => { setAppState(AppState.IDLE); setResult(null); setSongId(''); setSunoToken(''); }}
                className="text-sm text-zinc-400 hover:text-white px-3 py-1 rounded-lg border border-zinc-800 hover:bg-zinc-800 transition-colors"
               >
                 Create Another
               </button>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Preview List (Now Editable) */}
              <div className="md:col-span-1 bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col max-h-[600px]">
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur sticky top-0 z-10 flex justify-between items-center">
                  <h3 className="font-semibold text-zinc-300 flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Live Editor
                  </h3>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Click times to edit</span>
                </div>
                <div className="overflow-y-auto p-2 space-y-1 flex-1">
                  {result.lines.map((line, idx) => (
                    <div key={idx} className="group hover:bg-zinc-800/50 p-2 rounded-lg transition-colors border border-transparent hover:border-zinc-700/50">
                      <div className="flex justify-between items-center text-xs text-indigo-400 font-mono mb-2 opacity-80 group-hover:opacity-100">
                        <TimeInput 
                          seconds={line.startTime} 
                          onChange={(v) => updateLine(idx, { startTime: v })} 
                          className="w-[70px] text-left"
                        />
                        <div className="h-px bg-indigo-500/20 flex-1 mx-2"></div>
                        <TimeInput 
                          seconds={line.endTime} 
                          onChange={(v) => updateLine(idx, { endTime: v })} 
                          className="w-[70px] text-right"
                        />
                      </div>
                      <input
                        type="text"
                        value={line.text}
                        onChange={(e) => updateLine(idx, { text: e.target.value })}
                        className="w-full bg-transparent border-none p-0 text-sm text-zinc-300 group-hover:text-white focus:text-white focus:outline-none placeholder:text-zinc-700 transition-colors"
                      />
                    </div>
                  ))}
                  {result.lines.length === 0 && (
                    <div className="text-zinc-500 text-center py-10 text-sm">
                      No matching lines found.
                    </div>
                  )}
                </div>
              </div>

              {/* Editor/Export Area */}
              <div className="md:col-span-2 space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col h-[600px]">
                  {/* Tabs */}
                  <div className="flex border-b border-zinc-800">
                    <button
                      onClick={() => setActiveTab('lrc')}
                      className={`flex-1 py-4 text-sm font-medium transition-colors border-b-2 ${
                        activeTab === 'lrc'
                          ? 'border-indigo-500 text-white bg-zinc-800/30'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                      }`}
                    >
                      .LRC (Karaoke)
                    </button>
                    <button
                      onClick={() => setActiveTab('srt')}
                      className={`flex-1 py-4 text-sm font-medium transition-colors border-b-2 ${
                        activeTab === 'srt'
                          ? 'border-indigo-500 text-white bg-zinc-800/30'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                      }`}
                    >
                      .SRT (Subtitles)
                    </button>
                  </div>

                  {/* Content Display */}
                  <div className="relative flex-1 bg-zinc-950">
                    <textarea
                      readOnly
                      value={activeTab === 'lrc' ? result.lrcContent : result.srtContent}
                      className="w-full h-full bg-transparent p-6 text-sm font-mono text-zinc-300 resize-none outline-none leading-relaxed"
                    />
                    
                    {/* Floating Actions */}
                    <div className="absolute bottom-6 right-6 flex items-center gap-3">
                      <button
                        onClick={copyToClipboard}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg shadow-lg border border-zinc-700 transition-all active:scale-95"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={downloadFile}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <Footer git="https://github.com/xiliourt/Lyrical-Sync" />
      </main>
    </div>
  );
};

export default App;
