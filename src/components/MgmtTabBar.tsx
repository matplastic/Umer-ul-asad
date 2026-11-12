import React from 'react';

/**
 * MetalTabButton
 * ----------------------------------------------------------------------------
 * Reusable "brushed metal" embossed tab button, matching the reference style
 * (light gray/white surface, soft raised bevel, pressed/active inset state).
 *
 * Usage:
 *
 *   import { MetalTabButton } from './MetalTabButton';
 *
 *   const [activeTab, setActiveTab] = useState('store');
 *
 *   <div style={{ display: 'flex', gap: 10 }}>
 *     <MetalTabButton active={activeTab === 'planning'} onClick={() => setActiveTab('planning')}>
 *       Planning
 *     </MetalTabButton>
 *     <MetalTabButton active={activeTab === 'store'} onClick={() => setActiveTab('store')}>
 *       Store
 *     </MetalTabButton>
 *     <MetalTabButton active={activeTab === 'hr'} onClick={() => setActiveTab('hr')}>
 *       HR
 *     </MetalTabButton>
 *   </div>
 *
 * No external CSS file needed — styles are inline so this component is
 * fully drop-in. If you'd rather use the .btn-metal / .btn-metal.active
 * classes directly (e.g. on plain <button> tags elsewhere), see
 * metal-button.css in this same folder.
 * ----------------------------------------------------------------------------
 */

interface MetalTabButtonProps {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function MetalTabButton({ active = false, onClick, children, disabled = false }: MetalTabButtonProps) {
  const [hover, setHover] = React.useState(false);

  const baseStyle: React.CSSProperties = {
    flex: 1,
    padding: '12px 24px',
    border: 'none',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
  };

  const idleStyle: React.CSSProperties = {
    ...baseStyle,
    color: '#4a4f57',
    background: 'linear-gradient(180deg, #f6f7f9 0%, #e2e4e8 100%)',
    boxShadow: hover
      ? '0 6px 10px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.15)'
      : '0 3px 5px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.15)',
    transform: hover && !disabled ? 'translateY(-2px)' : 'translateY(0)',
  };

  const activeStyle: React.CSSProperties = {
    ...baseStyle,
    color: '#3a3e45',
    background: 'linear-gradient(180deg, #e8eaed 0%, #d3d6db 100%)',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.15), inset 0 -1px 0 rgba(255,255,255,0.7)',
  };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      style={active ? activeStyle : idleStyle}
    >
      {children}
    </button>
  );
}
