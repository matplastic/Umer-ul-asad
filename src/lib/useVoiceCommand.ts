import { useEffect, useRef, useState, useCallback } from 'react';

// Thin wrapper around the browser's Web Speech API (SpeechRecognition).
// Used by the "Ask AI" chat widgets (Quality Inspector, Management) to let
// an inspector/manager speak a command instead of typing it. Purely a
// dictation aid — it only ever produces text for the existing input box;
// it never executes anything on its own.
//
// Browser support: Chrome, Edge, and most Chromium-based browsers via the
// webkitSpeechRecognition prefix. Safari has partial/unreliable support.
// Firefox does not support it. When unsupported, `isSupported` is false and
// the caller should hide the mic button rather than show a broken one.

interface UseVoiceCommandOptions {
  // Called with the final recognized transcript once the user stops talking.
  onResult: (transcript: string) => void;
  // BCP-47 language tag. Defaults to the browser's language.
  lang?: string;
}

interface UseVoiceCommandReturn {
  isSupported: boolean;
  isListening: boolean;
  // Live partial transcript while the mic is active — useful for showing
  // "hearing: ..." feedback before the final result fires.
  interimTranscript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export function useVoiceCommand({ onResult, lang }: UseVoiceCommandOptions): UseVoiceCommandReturn {
  const SpeechRecognitionCtor =
    typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
  const isSupported = !!SpeechRecognitionCtor;

  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (!isSupported) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');

    recognition.onstart = () => {
      setError(null);
      setIsListening(true);
    };
    recognition.onresult = (event: any) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      setInterimTranscript(interimText);
      if (finalText.trim()) {
        onResultRef.current(finalText.trim());
      }
    };
    recognition.onerror = (event: any) => {
      // "no-speech" and "aborted" fire routinely (e.g. mic released early)
      // — don't surface those as errors, just stop quietly.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(
          event.error === 'not-allowed' || event.error === 'permission-denied'
            ? 'Microphone permission was denied.'
            : 'Voice input failed — try again.'
        );
      }
      setIsListening(false);
      setInterimTranscript('');
    };
    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch { /* noop */ }
      recognitionRef.current = null;
    };
  }, [isSupported, SpeechRecognitionCtor, lang]);

  const start = useCallback(() => {
    if (!recognitionRef.current || isListening) return;
    try {
      recognitionRef.current.start();
    } catch {
      // start() throws if already started — safe to ignore.
    }
  }, [isListening]);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    try { recognitionRef.current.stop(); } catch { /* noop */ }
  }, []);

  const toggle = useCallback(() => {
    if (isListening) stop(); else start();
  }, [isListening, start, stop]);

  return { isSupported, isListening, interimTranscript, error, start, stop, toggle };
}
