// @ts-nocheck
import React from 'react';

interface State { error: Error | null; info: string }

// Catches any render crash and shows the real error on screen instead of a
// blank white page, so the cause can be read (or screenshotted) directly.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ info: info.componentStack || '' });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ color: '#be123c', margin: '0 0 8px' }}>Something went wrong on this screen</h2>
        <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px' }}>
          Your data is safe. Tap Reload, or take a screenshot of this message and send it to the developer.
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, padding: 12 }}>
{String(this.state.error?.message || this.state.error)}
{this.state.info ? '\n' + this.state.info.split('\n').slice(0, 8).join('\n') : ''}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: '10px 18px', background: '#0f766e', color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
        >
          Reload
        </button>
      </div>
    );
  }
}
