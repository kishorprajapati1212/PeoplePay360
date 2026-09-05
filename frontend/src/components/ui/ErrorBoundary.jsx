import { Component } from 'react';

/**
 * Catches a render error in one screen so the rest of the app survives: the sidebar, the top bar and
 * "try again" stay available instead of a white page with a console message. React only offers this as
 * a class component, which is why this file looks different from everything else in src/.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the stack in the console for the person who is debugging, but never let it blank the screen.
    console.error('[ui]', error, info?.componentStack?.split('\n').slice(1, 4).join(' '));
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="panel panel-pad">
        <h2 className="text-sm font-semibold text-slate-100">This panel could not be drawn</h2>
        <p className="mt-1 text-sm text-slate-400">
          {String(error.message || error).slice(0, 240)}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          The rest of the app still works. If this keeps happening after a reload, the API returned something this
          screen did not expect — the response for the failing call is in the browser console.
        </p>
        <div className="mt-3 flex gap-2">
          <button className="btn-primary btn-sm" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn-ghost btn-sm" onClick={() => window.location.reload()}>Reload the page</button>
        </div>
      </div>
    );
  }
}
