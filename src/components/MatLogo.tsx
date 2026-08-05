import React from 'react';

/**
 * Animated MAT Plastic Industries logo mark, traced directly from the
 * official logo (exact vector paths — not a redrawn approximation).
 * Plays a one-time entrance (letters slide in, triangle pops in with a
 * glow) then settles into a slow ambient glow pulse.
 *
 * Usage: <MatLogo className="h-12 w-auto" />
 */
export const MatLogo: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={className} style={{ display: 'inline-block', lineHeight: 0 }}>
      <style>{`
        @keyframes matlogoSlideL{ from{ opacity:0; transform:translateX(-40px); } to{ opacity:1; transform:translateX(0); } }
        @keyframes matlogoSlideR{ from{ opacity:0; transform:translateX(40px); } to{ opacity:1; transform:translateX(0); } }
        @keyframes matlogoTriIn{ from{ opacity:0; transform:scale(.85) translateY(-10px); } to{ opacity:1; transform:scale(1) translateY(0); } }
        @keyframes matlogoGlow{
          0%,100%{ filter:drop-shadow(0 0 0 rgba(250,224,5,0)); }
          50%{ filter:drop-shadow(0 0 10px rgba(250,224,5,.55)); }
        }
        .matlogo-letters path{ fill:#A0A0A0; }
        .matlogo-m{ opacity:0; animation:matlogoSlideL .6s cubic-bezier(.2,.8,.2,1) .1s forwards; }
        .matlogo-t{ opacity:0; animation:matlogoSlideR .6s cubic-bezier(.2,.8,.2,1) .1s forwards; }
        .matlogo-tri path{ fill:#FAE005; }
        .matlogo-tri{
          opacity:0;
          animation: matlogoTriIn .6s cubic-bezier(.2,.8,.2,1) .45s forwards,
                     matlogoGlow 2.6s ease-in-out 1.2s infinite;
        }
      `}</style>
      <svg viewBox="0 0 512 315" style={{ height: '100%', width: 'auto', aspectRatio: '512 / 315', display: 'block', overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
        <g className="matlogo-letters">
          <g className="matlogo-m"><g transform="translate(0.000000,315.000000) scale(0.100000,-0.100000)">
            <path d="M196 1568 c-14 -20 -16 -87 -16 -560 0 -521 1 -538 19 -548 11 -6 87
-10 176 -10 152 0 156 1 180 25 24 23 25 29 25 165 0 77 4 140 8 140 14 0 35
-29 92 -122 29 -48 58 -89 65 -92 7 -2 20 3 28 12 8 9 99 163 203 342 103 179
222 386 265 460 60 104 77 142 72 160 -11 46 -26 50 -193 50 -110 0 -161 -4
-172 -12 -8 -7 -52 -79 -98 -160 -53 -94 -90 -148 -100 -148 -10 0 -49 58
-106 158 l-91 157 -171 3 c-167 2 -171 2 -186 -20z"/>
            <path d="M1289 1318 c-12 -24 -90 -164 -173 -313 l-151 -270 0 -65 c0 -91 31 -145
105 -185 48 -25 68 -30 153 -33 l97 -4 0 456 c0 251 -2 456 -5 456 -2 0 -14
-19 -26 -42z"/>
          </g></g>
          <g className="matlogo-t"><g transform="translate(0.000000,315.000000) scale(0.100000,-0.100000)">
            <path d="M3490 1584 c0 -4 22 -45
49 -93 27 -47 74 -129 103 -181 l55 -95 188 -3 c136 -2 191 -6 197 -15 4 -6 8
-166 8 -355 l0 -343 25 -24 c23 -24 28 -25 174 -25 123 0 152 3 165 16 9 8 17
16 18 17 1 1 5 164 8 361 l5 360 30 1 c17 1 115 2 218 3 185 2 188 2 212 27
24 23 25 29 25 167 0 114 -3 148 -16 166 l-15 22 -725 0 c-398 0 -724 -3 -724
-6z"/>
          </g></g>
        </g>
        <g className="matlogo-tri"><g transform="translate(0.000000,315.000000) scale(0.100000,-0.100000)">
          <path d="M2355 3034 c-72 -25 -139 -99 -226 -251 -13 -23 -62 -109 -108 -190
-46 -82 -113 -196 -148 -255 -77 -130 -173 -299 -173 -305 0 -3 -13 -23 -29
-46 -26 -39 -173 -288 -245 -417 l-31 -55 2 -522 c1 -287 4 -527 8 -533 4 -7
326 -10 1000 -10 873 0 994 2 999 15 8 21 0 39 -61 132 -29 45 -53 84 -53 86
0 10 -104 175 -126 199 l-24 28 -724 0 c-441 0 -735 4 -750 10 -51 19 -42 86
28 194 18 28 46 74 61 101 15 28 55 97 88 155 33 58 86 150 117 205 32 55 85
148 119 206 33 58 61 111 61 118 0 6 5 11 10 11 6 0 10 4 10 9 0 5 17 38 38
72 21 35 52 89 69 119 56 104 102 167 124 173 26 7 59 -5 80 -29 18 -21 183
-296 214 -356 11 -21 23 -38 27 -38 5 0 7 -4 5 -9 -2 -8 38 -82 91 -165 13
-22 38 -65 55 -95 16 -31 36 -63 43 -72 8 -8 14 -18 14 -21 0 -8 186 -330 301
-523 46 -78 131 -225 189 -327 100 -178 107 -186 140 -192 19 -3 130 -6 246
-6 259 0 254 -2 199 103 -20 39 -43 79 -49 87 -7 8 -18 26 -24 40 -7 14 -22
41 -35 61 -38 61 -171 288 -186 317 -7 15 -23 43 -36 62 -12 19 -59 100 -105
180 -45 80 -94 163 -109 185 -14 22 -31 51 -37 65 -10 22 -59 107 -224 390
-21 36 -91 157 -155 270 -65 113 -126 217 -136 232 -11 15 -19 29 -19 32 0 3
-24 45 -52 93 -29 48 -56 95 -60 105 -4 9 -29 51 -56 95 -27 43 -59 98 -71
122 -38 74 -97 129 -155 145 -59 16 -85 16 -131 0z"/>
        </g></g>
      </svg>
    </div>
  );
};

export default MatLogo;
