import { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

// Global floating Page Up / Page Down buttons — visible on every portal/page.
export function ScrollButtons() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const scrollable = document.documentElement.scrollHeight > window.innerHeight + 40;
      setVisible(scrollable);
    };
    const debouncedCheck = () => {
      if (t) clearTimeout(t);
      t = setTimeout(check, 250);
    };
    check();
    window.addEventListener('scroll', debouncedCheck, { passive: true });
    window.addEventListener('resize', debouncedCheck);
    const obs = new MutationObserver(debouncedCheck);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('scroll', debouncedCheck);
      window.removeEventListener('resize', debouncedCheck);
      obs.disconnect();
    };
  }, []);

  if (!visible) return null;

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const scrollToBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });

  return (
    <div className="fixed right-4 bottom-28 z-[9999] flex flex-col gap-2 print:hidden">
      <button
        type="button"
        onClick={scrollToTop}
        data-testid="scroll-to-top-btn"
        title="Page Up (scroll to top)"
        aria-label="Scroll to top"
        className="h-11 w-11 rounded-full bg-slate-900/90 hover:bg-cyan-600 border border-slate-700 hover:border-cyan-400 text-slate-300 hover:text-white shadow-lg shadow-black/40 flex items-center justify-center cursor-pointer transition-colors backdrop-blur"
      >
        <ChevronUp className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={scrollToBottom}
        data-testid="scroll-to-bottom-btn"
        title="Page Down (scroll to bottom)"
        aria-label="Scroll to bottom"
        className="h-11 w-11 rounded-full bg-slate-900/90 hover:bg-cyan-600 border border-slate-700 hover:border-cyan-400 text-slate-300 hover:text-white shadow-lg shadow-black/40 flex items-center justify-center cursor-pointer transition-colors backdrop-blur"
      >
        <ChevronDown className="h-5 w-5" />
      </button>
    </div>
  );
}
