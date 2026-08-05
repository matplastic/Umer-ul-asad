// src/components/SplashScreen.tsx
// MAT Plastic Industries — Animated splash/login screen
// Usage: Show this component on app mount, hide it once auth is ready.

import { useEffect, useState } from "react";

interface SplashScreenProps {
  /** Called when the animation finishes (~3 s). Use to show your main app. */
  onFinish?: () => void;
  /** Optional status text. Defaults to "SIGNING YOU IN…" */
  statusText?: string;
}

export default function SplashScreen({
  onFinish,
  statusText = "SIGNING YOU IN\u2026",
}: SplashScreenProps) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDone(true);
      onFinish?.();
    }, 3200); // total animation duration
    return () => clearTimeout(t);
  }, [onFinish]);

  if (done) return null;

  return (
    <div className="mat-splash">
      {/* ── Logo ── */}
      <div className="mat-logo-wrap">
        <svg viewBox="0 0 512 315" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
          {/* Gray M */}
          <g className="mat-letters">
            <g className="mat-letter-m">
              <g transform="translate(0,315) scale(0.1,-0.1)">
                <path d="M196 1568 c-14 -20 -16 -87 -16 -560 0 -521 1 -538 19 -548 11 -6 87-10 176 -10 152 0 156 1 180 25 24 23 25 29 25 165 0 77 4 140 8 140 14 0 35-29 92 -122 29 -48 58 -89 65 -92 7 -2 20 3 28 12 8 9 99 163 203 342 103 179 222 386 265 460 60 104 77 142 72 160 -11 46 -26 50 -193 50 -110 0 -161 -4-172 -12 -8 -7 -52 -79 -98 -160 -53 -94 -90 -148 -100 -148 -10 0 -49 58-106 158 l-91 157 -171 3 c-167 2 -171 2 -186 -20z" />
                <path d="M1289 1318 c-12 -24 -90 -164 -173 -313 l-151 -270 0 -65 c0 -91 31 -145 105 -185 48 -25 68 -30 153 -33 l97 -4 0 456 c0 251 -2 456 -5 456 -2 0 -14-19 -26 -42z" />
              </g>
            </g>
            {/* Gray T */}
            <g className="mat-letter-t">
              <g transform="translate(0,315) scale(0.1,-0.1)">
                <path d="M3490 1584 c0 -4 22 -45 49 -93 27 -47 74 -129 103 -181 l55 -95 188 -3 c136 -2 191 -6 197 -15 4 -6 8-166 8 -355 l0 -343 25 -24 c23 -24 28 -25 174 -25 123 0 152 3 165 16 9 8 17 16 18 17 1 1 5 164 8 361 l5 360 30 1 c17 1 115 2 218 3 185 2 188 2 212 27 24 23 25 29 25 167 0 114 -3 148 -16 166 l-15 22 -725 0 c-398 0 -724 -3 -724-6z" />
              </g>
            </g>
          </g>
          {/* Yellow triangle */}
          <g className="mat-tri">
            <g transform="translate(0,315) scale(0.1,-0.1)">
              <path d="M2355 3034 c-72 -25 -139 -99 -226 -251 -13 -23 -62 -109 -108 -190-46 -82 -113 -196 -148 -255 -77 -130 -173 -299 -173 -305 0 -3 -13 -23 -29-46 -26 -39 -173 -288 -245 -417 l-31 -55 2 -522 c1 -287 4 -527 8 -533 4 -7 326 -10 1000 -10 873 0 994 2 999 15 8 21 0 39 -61 132 -29 45 -53 84 -53 86 0 10 -104 175 -126 199 l-24 28 -724 0 c-441 0 -735 4 -750 10 -51 19 -42 86 28 194 18 28 46 74 61 101 15 28 55 97 88 155 33 58 86 150 117 205 32 55 85 148 119 206 33 58 61 111 61 118 0 6 5 11 10 11 6 0 10 4 10 9 0 5 17 38 38 72 21 35 52 89 69 119 56 104 102 167 124 173 26 7 59 -5 80 -29 18 -21 183-296 214 -356 11 -21 23 -38 27 -38 5 0 7 -4 5 -9 -2 -8 38 -82 91 -165 13-22 38 -65 55 -95 16 -31 36 -63 43 -72 8 -8 14 -18 14 -21 0 -8 186 -330 301-523 46 -78 131 -225 189 -327 100 -178 107 -186 140 -192 19 -3 130 -6 246-6 259 0 254 -2 199 103 -20 39 -43 79 -49 87 -7 8 -18 26 -24 40 -7 14 -22 41 -35 61 -38 61 -171 288 -186 317 -7 15 -23 43 -36 62 -12 19 -59 100 -105 180 -45 80 -94 163 -109 185 -14 22 -31 51 -37 65 -10 22 -59 107 -224 390-21 36 -91 157 -155 270 -65 113 -126 217 -136 232 -11 15 -19 29 -19 32 0 3-24 45 -52 93 -29 48 -56 95 -60 105 -4 9 -29 51 -56 95 -27 43 -59 98 -71 122 -38 74 -97 129 -155 145 -59 16 -85 16 -131 0z" />
            </g>
          </g>
        </svg>
      </div>

      {/* ── Subtitle ── */}
      <div className="mat-subtitle">
        <p className="mat-name">PLASTIC&nbsp;&nbsp;INDUSTRIES&nbsp;&nbsp;L.L.C</p>
        <div className="mat-rule" />
      </div>

      {/* ── Status ── */}
      <div className="mat-hint">{statusText}</div>

      {/* ── Scoped styles ── */}
      <style>{`
        .mat-splash {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 24px;
          background: radial-gradient(1200px 700px at 50% 30%, #0e6a6d 0%, #0B4F52 45%, #06322F 100%);
          font-family: 'Segoe UI', Arial, sans-serif;
          overflow: hidden;
        }
        .mat-logo-wrap {
          width: min(88vw, 640px);
        }

        /* ── Letters ── */
        .mat-letters path { fill: #A0A0A0; }

        .mat-letter-m {
          opacity: 0;
          transform: translateX(-40px);
          animation: mat-slideL 0.7s cubic-bezier(.2,.8,.2,1) 0.5s forwards;
        }
        .mat-letter-t {
          opacity: 0;
          transform: translateX(40px);
          animation: mat-slideR 0.7s cubic-bezier(.2,.8,.2,1) 0.5s forwards;
        }
        @keyframes mat-slideL { to { opacity:1; transform:translateX(0); } }
        @keyframes mat-slideR { to { opacity:1; transform:translateX(0); } }

        /* ── Triangle ── */
        .mat-tri path { fill: #FAE005; }
        .mat-tri {
          opacity: 0;
          transform-box: fill-box;
          transform-origin: 50% 100%;
          animation:
            mat-triIn 0.8s cubic-bezier(.2,.8,.2,1) 1s forwards,
            mat-glow  2.6s ease-in-out 2s infinite;
        }
        @keyframes mat-triIn {
          from { opacity:0; transform:scale(.85) translateY(-10px); }
          to   { opacity:1; transform:scale(1)   translateY(0); }
        }
        @keyframes mat-glow {
          0%,100% { filter: drop-shadow(0 0 0   rgba(250,224,5,0)); }
          50%     { filter: drop-shadow(0 0 16px rgba(250,224,5,.6)); }
        }

        /* ── Subtitle ── */
        .mat-subtitle {
          text-align: center;
          opacity: 0;
          animation: mat-fadeUp 0.7s ease-out 1.85s forwards;
        }
        @keyframes mat-fadeUp {
          from { opacity:0; transform:translateY(10px); letter-spacing:6px; }
          to   { opacity:1; transform:translateY(0);    letter-spacing:3px; }
        }
        .mat-name {
          color: #fff;
          font-size: clamp(14px, 2.6vw, 20px);
          font-weight: 700;
          letter-spacing: 3px;
          margin: 0;
        }
        .mat-rule {
          width: 60px; height: 2px;
          background: #FAE005;
          margin: 14px auto 0;
          transform: scaleX(0);
          transform-origin: center;
          animation: mat-growRule 0.6s ease-out 2.1s forwards;
        }
        @keyframes mat-growRule { to { transform: scaleX(1); } }

        /* ── Hint ── */
        .mat-hint {
          opacity: 0;
          color: rgba(255,255,255,.55);
          font-size: 12px;
          letter-spacing: 2px;
          animation: mat-fadeUp 0.7s ease-out 2.35s forwards;
        }
      `}</style>
    </div>
  );
}
