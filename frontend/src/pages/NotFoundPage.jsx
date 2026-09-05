import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="panel panel-pad mx-auto mt-10 max-w-lg text-center">
      <p className="text-4xl">◇</p>
      <h1 className="mt-2 text-base font-semibold text-slate-100">That screen does not exist</h1>
      <p className="mt-1 text-sm text-slate-400">The link may be from an older build, or your role does not have that module.</p>
      <Link className="btn-primary mt-4 inline-flex" to="/">Go to my dashboard</Link>
    </div>
  );
}
